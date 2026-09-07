import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import pg from "pg";
import { z } from "zod";

const migrationRows = z.array(z.object({
  migration_name: z.string().min(1),
  checksum: z.string().regex(/^[a-f0-9]{64}$/u),
  applied: z.boolean(),
  rolled_back: z.boolean(),
}));

export function readMigrationManifest(rootDirectory) {
  const directory = resolve(rootDirectory, "prisma/migrations");
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => ({
      name: entry.name,
      checksum: createHash("sha256")
        .update(readFileSync(resolve(directory, entry.name, "migration.sql")))
        .digest("hex"),
    }));
}

// Check the database on every invocation. A host-side success marker cannot
// detect a restored/replaced database or an interrupted migration.
export function inspectMigrationHistory(manifest, input) {
  const rows = migrationRows.parse(input).filter((row) => !row.rolled_back);
  const expected = new Map(manifest.map((entry) => [entry.name, entry.checksum]));
  const applied = new Set();
  let historyMatches = true;
  for (const row of rows) {
    if (!row.applied) throw new Error(`Unfinished database migration: ${row.migration_name}`);
    if (!expected.has(row.migration_name)) throw new Error(`Database migration is missing from this checkout: ${row.migration_name}`);
    if (expected.get(row.migration_name) !== row.checksum) historyMatches = false;
    if (applied.has(row.migration_name)) {
      throw new Error(`Duplicate applied database migration: ${row.migration_name}`);
    }
    applied.add(row.migration_name);
  }
  return { pending: manifest.filter((entry) => !applied.has(entry.name)).map((entry) => entry.name), historyMatches };
}

export function developmentDatabaseConnection(environment) {
  const url = new URL(environment.DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("DATABASE_URL must use PostgreSQL");
  }
  const bundled = url.hostname === "postgres";
  if (bundled) {
    const host = environment.POSTGRES_BIND_ADDRESS?.trim() || "127.0.0.1";
    url.hostname = ["0.0.0.0", "::"].includes(host) ? "127.0.0.1" : host;
    url.port = environment.POSTGRES_PORT?.trim() || "5432";
  }
  const schema = url.searchParams.get("schema") || "public";
  url.searchParams.delete("schema");
  return { connectionString: url.toString(), schema, bundled };
}

export async function inspectDevelopmentDatabase(environment, manifest, createClient = (config) => new pg.Client(config)) {
  const { connectionString, schema } = developmentDatabaseConnection(environment);
  const client = createClient({
    connectionString,
    connectionTimeoutMillis: 2_000,
    statement_timeout: 2_000,
    query_timeout: 2_500,
    application_name: "linksense-dev-preflight",
  });
  const namespace = `"${schema.replaceAll('"', '""')}"`;
  try {
    await client.connect();
    const tables = z.object({ migrations: z.string().nullable(), settings: z.string().nullable() }).parse(
      (await client.query(
        "SELECT to_regclass($1)::text AS migrations, to_regclass($2)::text AS settings",
        [`${namespace}."_prisma_migrations"`, `${namespace}."system_settings"`],
      )).rows[0],
    );
    const rows = tables.migrations
      ? (await client.query(`SELECT migration_name, checksum, finished_at IS NOT NULL AS applied, rolled_back_at IS NOT NULL AS rolled_back FROM ${namespace}."_prisma_migrations"`)).rows
      : [];
    const history = inspectMigrationHistory(manifest, rows);
    const seeded = tables.settings
      ? z.object({ seeded: z.boolean() }).parse((await client.query(
          `SELECT EXISTS (SELECT 1 FROM ${namespace}."system_settings" WHERE id = $1::uuid) AS seeded`,
          ["00000000-0000-4000-8000-000000000001"],
        )).rows[0]).seeded
      : false;
    const validationFingerprint = createHash("sha256").update(JSON.stringify([
      connectionString, schema, manifest,
      rows.map((row) => JSON.stringify(row)).sort(),
    ])).digest("hex");
    return { ...history, seeded, validationFingerprint };
  } finally {
    await client.end();
  }
}

function readValidationFingerprint(path) {
  if (!path) return null;
  try {
    const value = z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/u) }).safeParse(JSON.parse(readFileSync(path, "utf8")));
    return value.success ? value.data.fingerprint : null;
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function prepareDevelopmentDatabase({ inspect, deploy, seed, synchronizeCredentials, bundled, validationPath, warn = console.warn }) {
  let state;
  try {
    state = await inspect();
  } catch (error) {
    // Only repair the bundled development role after a real authentication
    // failure; external databases are never modified by this repair path.
    if (!bundled || error?.code !== "28P01") throw error;
    await synchronizeCredentials();
    state = await inspect();
  }
  // Cache only Prisma's successful check of these exact local files AND actual
  // database rows. We still inspect the database every time and never rewrite
  // migration history or pretend a historical checksum difference was repaired.
  const previouslyValidated = Boolean(state.validationFingerprint) &&
    readValidationFingerprint(validationPath) === state.validationFingerprint;
  const needsDeploy = state.pending.length > 0 || (state.historyMatches === false && !previouslyValidated);
  if (needsDeploy) {
    await deploy();
    state = await inspect();
    if (state.pending.length > 0) throw new Error("Database migrations are still pending after migrate deploy");
  }
  if (!state.seeded) {
    await seed();
    state = await inspect();
    if (!state.seeded) throw new Error("Database initialization did not complete");
  }
  if (state.historyMatches === false) {
    warn("Warning: historical migration checksums differ from this checkout; Prisma's deployment check accepted this history. No history or existing data was rewritten.");
    if (needsDeploy && validationPath && state.validationFingerprint) {
      mkdirSync(dirname(validationPath), { recursive: true });
      const temporary = `${validationPath}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify({ fingerprint: state.validationFingerprint }), { mode: 0o600 });
      renameSync(temporary, validationPath);
    }
  }
  return state;
}
