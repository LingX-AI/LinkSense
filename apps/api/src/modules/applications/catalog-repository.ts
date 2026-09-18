import { z } from "zod";
import type { ApplicationIcon, Application, ApplicationCatalogPage, ApplicationCatalogQuery } from "@linksense/shared";
import { applicationCatalogPageSchema, interactiveDependenciesSchema } from "@linksense/shared";
import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";

const catalogKeySchema = z.string().regex(/^(?:application|development):[0-9a-f-]{36}$/u);
const cursorSchema = z.strictObject({ at: z.iso.datetime(), key: catalogKeySchema });
const rowSchema = z.object({
  key: catalogKeySchema,
  application_id: z.uuid().nullable(),
  development_id: z.uuid().nullable(),
  conversation_id: z.uuid().nullable(),
  development_name: z.string().nullable(),
  development_updated_at: z.date().nullable(),
  development_icon_preset: z.string().nullable().optional(),
  development_icon_object_key: z.string().nullable().optional(),
  development_description: z.string().nullable().optional(),
  development_dependencies: interactiveDependenciesSchema.nullable(),
  has_changes: z.boolean(),
  sort_timestamp: z.iso.datetime(),
});
export type ApplicationCatalogRow = z.infer<typeof rowSchema>;

function readCursor(value: string | undefined): z.infer<typeof cursorSchema> | null {
  if (!value) return null;
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
  } catch {
    throw new AppError("VALIDATION_ERROR");
  }
}

export async function readOwnedApplicationCatalog(
  db: PrismaClient,
  ownerId: string,
  input: ApplicationCatalogQuery,
): Promise<ApplicationCatalogRow[]> {
  const cursor = readCursor(input.cursor);
  const sortColumn = input.state === "developing" ? Prisma.sql`development_updated_at` : Prisma.sql`created_at`;
  // A development and its installed application form one catalog entry. Hidden
  // preview applications remain excluded from normal application access paths.
  const rows = await db.$queryRaw(Prisma.sql`
    WITH owned_development AS (
      SELECT d.* FROM application_developments d
      WHERE d.owner_id = ${ownerId}::uuid
    ), catalog AS (
      SELECT 'application:' || a.id::text AS key, a.id AS application_id,
        d.id AS development_id, d.conversation_id, d.name AS development_name,
        d.updated_at AS development_updated_at,
        p.icon_preset AS development_icon_preset, p.icon_object_key AS development_icon_object_key, p.description AS development_description,
        package.manifest_json->'dependencies' AS development_dependencies,
        (d.id IS NOT NULL AND (d.installed_source_hash IS NULL
          OR d.source_hash IS DISTINCT FROM d.installed_source_hash OR d.source_error IS NOT NULL)) AS has_changes,
        a.created_at, a.name, a.description, a.kind
      FROM applications a LEFT JOIN owned_development d ON d.application_id = a.id
      LEFT JOIN applications p ON p.id = d.preview_application_id AND p.owner_id = d.owner_id AND p.development_only = true
      LEFT JOIN interactive_application_packages package ON package.id = p.interactive_package_id AND package.application_id = p.id
      WHERE a.owner_id = ${ownerId}::uuid AND a.development_only = false AND a.status IN ('active', 'disabled')
      UNION ALL
      SELECT 'development:' || d.id::text, NULL::uuid, d.id, d.conversation_id, d.name,
        d.updated_at, p.icon_preset, p.icon_object_key, p.description, package.manifest_json->'dependencies', true, d.created_at, d.name, p.description, 'interactive'::text
      FROM owned_development d LEFT JOIN applications p ON p.id = d.preview_application_id AND p.owner_id = d.owner_id AND p.development_only = true
      LEFT JOIN interactive_application_packages package ON package.id = p.interactive_package_id AND package.application_id = p.id
      WHERE d.application_id IS NULL
    )
    SELECT key, application_id, development_id, conversation_id, development_name,
      development_updated_at, development_icon_preset, development_icon_object_key, development_description, development_dependencies, has_changes,
      to_char(${sortColumn} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS sort_timestamp
    FROM catalog WHERE true
      ${input.state === "developing" ? Prisma.sql`AND has_changes = true` : Prisma.empty}
      ${input.state === "standard" || input.state === "interactive" ? Prisma.sql`AND kind = ${input.state}` : Prisma.empty}
      ${input.search ? Prisma.sql`AND (
        strpos(lower(name), lower(${input.search})) > 0
        OR strpos(lower(coalesce(description, '')), lower(${input.search})) > 0
        OR strpos(lower(coalesce(development_name, '')), lower(${input.search})) > 0
        OR strpos(lower(coalesce(development_description, '')), lower(${input.search})) > 0
      )` : Prisma.empty}
      ${cursor ? Prisma.sql`AND (${sortColumn}, key) < (${cursor.at}::timestamptz, ${cursor.key})` : Prisma.empty}
    ORDER BY ${sortColumn} DESC, key DESC LIMIT ${input.limit + 1}
  `);
  return z.array(rowSchema).parse(rows);
}

export function projectApplicationCatalogPage(
  rows: readonly ApplicationCatalogRow[],
  applications: readonly Application[],
  limit: number,
  developmentIcons: ReadonlyMap<string, ApplicationIcon> = new Map(),
): ApplicationCatalogPage {
  const visible = rows.slice(0, limit);
  const byId = new Map(applications.map(application => [application.id, application]));
  const last = visible.at(-1);
  return applicationCatalogPageSchema.parse({
    items: visible.flatMap(row => {
      const dependencies = row.development_dependencies;
      const development = row.development_id ? {
        id: row.development_id, conversation_id: row.conversation_id, name: row.development_name,
        ...(developmentIcons.has(row.development_id) ? { icon: developmentIcons.get(row.development_id) } : {}),
        ...(row.development_description !== undefined ? { description: row.development_description } : {}),
        capability_count: (dependencies?.plugins.length ?? 0) + (dependencies?.skills.length ?? 0),
        knowledge_base_count: dependencies?.knowledge_bases.length ?? 0,
        mcp_server_count: dependencies?.mcp_servers.length ?? 0,
        has_changes: row.has_changes, updated_at: row.development_updated_at?.toISOString(),
      } : null;
      if (!row.application_id) return [{ type: "development", development }];
      const application = byId.get(row.application_id);
      // A concurrent delete must not turn an installed entry into a fake draft.
      return application ? [{ type: "application", application, development }] : [];
    }),
    next_cursor: rows.length > limit && last
      ? Buffer.from(JSON.stringify({ at: last.sort_timestamp, key: last.key })).toString("base64url") : null,
  });
}
