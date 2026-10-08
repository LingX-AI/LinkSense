// Executed over stdin inside the installed API image, using its own dependencies
// and adapters. Only disposable installation-gate data is created here.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import pg from "pg"
import Redis from "ioredis"
import { parseConfig } from "./dist/config.js"
import { createObjectStorage } from "./dist/adapters/object-storage.js"
import { encryptJson, decryptJson } from "./dist/lib/crypto.js"

const [operation, id, userId] = process.argv.slice(2)
assert.ok(["seed", "verify"].includes(operation))
for (const value of [id, userId]) assert.match(value, /^[0-9a-f-]{36}$/u)
const config = parseConfig()
const text = `LinkSense installation verification ${id} 中文持久化验证`
const bytes = Buffer.from(text)
const hash = createHash("sha256").update(bytes).digest("hex")
const key = `release-verification/${id}`
const file = path.join(config.userDataRoot, `.release-verification-${id}`)
const database = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, statement_timeout: 10000 })
const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 0, connectTimeout: 10000 })
let phase = "database"
try {
  await database.connect()
  const result = await database.query('SELECT id, role FROM users WHERE id = $1', [userId])
  assert.equal(result.rows.length, 1, "Initialized administrator was not preserved")
  assert.equal(result.rows[0].role, "admin")
  const migrations = await database.query('SELECT count(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')
  assert.ok(migrations.rows[0].count > 0, "Database migrations were not applied")
  phase = "object storage initialization"
  const storage = createObjectStorage(config)
  await storage.ensureBucket()
  phase = "Redis connection"
  await redis.connect()
  phase = "persistence fixtures"
  if (operation === "seed") {
    await storage.putObject(key, bytes)
    await redis.set(key, hash)
    await writeFile(file, bytes, { mode: 0o600 })
    await storage.putObject(`${key}.encrypted`, Buffer.from(encryptJson({ text }, config.credentialMasterKey, config.credentialKeyId, key)))
  }
  const chunks = []
  for await (const chunk of await storage.getObjectStream(key)) chunks.push(Buffer.from(chunk))
  assert.ok(Buffer.concat(chunks).equals(bytes), "Object storage bytes changed")
  assert.equal(await redis.get(key), hash, "Redis data changed")
  assert.ok((await readFile(file)).equals(bytes), "User volume bytes changed")
  const encrypted = []
  for await (const chunk of await storage.getObjectStream(`${key}.encrypted`)) encrypted.push(Buffer.from(chunk))
  assert.ok(decryptJson(Buffer.concat(encrypted).toString("utf8"), config.credentialMasterKey, config.credentialKeyId, key).text === text, "Persisted encrypted configuration is no longer readable")
  if (config.edition === "full") {
    phase = "Elasticsearch retrieval"
    const { ElasticsearchKnowledgeAdapter, indexIntegrityDigest } = await import("./dist/modules/knowledge-processing/elasticsearch.js")
    const adapter = new ElasticsearchKnowledgeAdapter({ ...config.knowledge.elasticsearch, index: `linksense-knowledge-release-verification-${id}`, dimensions: 2 })
    const identity = { knowledgeBaseId: id, documentId: id, documentVersionId: id }
    const parents = [{ ...identity, parentId: id, parentOrder: 0, embeddingProfileHash: hash, titlePath: [], parentText: text, pageNumbers: [1], contentHash: hash, childIds: [id], childCount: 1,
      children: [{ childId: id, order: 0, text, rawText: text, titlePath: [], captions: [], docItems: [], pageNumbers: [1], numTokens: 20, contentHash: hash, vector: [1, 0] }],
    }]
    if (operation === "seed") {
      await adapter.ensureIndex()
      await adapter.replaceDocumentVersion({ ...identity, parents })
      await adapter.reconcileActiveDocumentVersion({ knowledgeBaseId: id, documentId: id, activeDocumentVersionId: id, expectedParentCount: 1, expectedChildCount: 1, expectedEmbeddingProfileHash: hash, expectedIndexIntegrityDigest: indexIntegrityDigest(parents) })
    }
    const filter = { knowledgeBaseIds: [id], embeddingProfileHash: hash }
    const lexical = await adapter.bm25Search({ query: "LinkSense", filter, size: 3 })
    const dense = await adapter.vectorSearch({ vector: [1, 0], filter, k: 1 })
    assert.ok(lexical.some(hit => hit.parentId === id && hit.parentText === text), "Persisted lexical retrieval failed")
    assert.ok(dense.some(hit => hit.parentId === id && hit.parentText === text), "Persisted vector retrieval failed")
  }
  process.stdout.write("Installed runtime persistence probe passed.\n")
} catch {
  // Avoid dumping connection strings or complete external responses to CI.
  process.stderr.write(`Installed runtime persistence probe failed (${phase}).\n`)
  process.exitCode = 1
} finally {
  redis.disconnect()
  await database.end()
}
