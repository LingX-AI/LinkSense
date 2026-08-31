const RESET_CONFIRMATION_PREFIX = "DELETE-KNOWLEDGE-EXTERNAL-STORAGE"
const DELETE_BATCH_SIZE = 1_000

const dangerousBucketNames = new Set([
  "backup",
  "backups",
  "data",
  "default",
  "files",
  "minio",
  "private",
  "prod",
  "production",
  "public",
  "root",
  "uploads",
])

const dangerousIndexNames = new Set([
  "_all",
  "all",
  "data",
  "default",
  "documents",
  "files",
  "prod",
  "production",
  "search",
])

export type KnowledgeStorageResetTargets = {
  primaryBucket: string
  knowledgeBucket: string
  elasticsearchIndex: string
}

export type KnowledgeStorageResetEnvironment = {
  targets: KnowledgeStorageResetTargets
  minio: {
    endpoint: string
    port: number
    useSsl: boolean
    region: string
    accessKey: string
    secretKey: string
  }
  elasticsearch: {
    url: string
    username: string
    password: string
  }
}

export type KnowledgeStorageResetCommand =
  | { mode: "plan" }
  | { mode: "execute"; confirmation: string }

export type KnowledgeBucketObjectVersion = {
  name?: string
  versionId?: string
}

export type KnowledgeBucketIncompleteUpload = {
  key?: string
}

export interface KnowledgeBucketResetClient {
  bucketExists(bucket: string): Promise<boolean>
  listObjectVersions(
    bucket: string,
  ): AsyncIterable<KnowledgeBucketObjectVersion>
  removeObjectVersions(
    bucket: string,
    objects: Array<{ name: string; versionId?: string }>,
  ): Promise<Array<{ error?: unknown }>>
  listIncompleteUploads(
    bucket: string,
  ): AsyncIterable<KnowledgeBucketIncompleteUpload>
  removeIncompleteUpload(bucket: string, objectName: string): Promise<void>
}

export interface KnowledgeIndexResetClient {
  ping(): Promise<void>
  indexExists(index: string): Promise<boolean>
  deleteIndex(index: string): Promise<void>
}

export type KnowledgeStorageResetResult =
  | {
      executed: false
      knowledgeBucket: string
      elasticsearchIndex: string
      requiredConfirmation: string
    }
  | {
      executed: true
      knowledgeBucket: string
      elasticsearchIndex: string
      deletedObjectVersions: number
      deletedIncompleteUploads: number
      deletedElasticsearchIndex: boolean
    }

export function parseKnowledgeStorageResetArguments(
  arguments_: readonly string[],
): KnowledgeStorageResetCommand {
  const values = arguments_[0] === "--" ? arguments_.slice(1) : arguments_
  if (values.length === 1 && values[0] === "--plan") {
    return { mode: "plan" }
  }
  if (
    values.length === 3 &&
    values[0] === "--execute" &&
    values[1] === "--confirm" &&
    values[2] !== ""
  ) {
    return { mode: "execute", confirmation: values[2]! }
  }
  throw new Error(
    "usage: --plan OR --execute --confirm <exact-plan-confirmation>",
  )
}

export function parseKnowledgeStorageResetEnvironment(
  environment: NodeJS.ProcessEnv,
): KnowledgeStorageResetEnvironment {
  const endpoint = requiredEnvironmentValue(environment, "MINIO_ENDPOINT")
  if (
    endpoint.includes("://") ||
    endpoint.includes("/") ||
    endpoint.includes("@") ||
    /\s/u.test(endpoint)
  ) {
    throw new Error("invalid MinIO endpoint for knowledge storage reset")
  }
  const portText = requiredEnvironmentValue(environment, "MINIO_PORT")
  const port = Number(portText)
  if (
    !/^[0-9]+$/u.test(portText) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw new Error("invalid MinIO port for knowledge storage reset")
  }
  const useSslText = requiredEnvironmentValue(environment, "MINIO_USE_SSL")
  if (useSslText !== "true" && useSslText !== "false") {
    throw new Error("invalid MinIO TLS flag for knowledge storage reset")
  }
  const elasticsearchUrlText = requiredEnvironmentValue(
    environment,
    "LINKSENSE_KB_ELASTICSEARCH_URL",
  )
  let elasticsearchUrl: URL
  try {
    elasticsearchUrl = new URL(elasticsearchUrlText)
  } catch {
    throw new Error("invalid Elasticsearch URL for knowledge storage reset")
  }
  if (
    (elasticsearchUrl.protocol !== "http:" &&
      elasticsearchUrl.protocol !== "https:") ||
    elasticsearchUrl.username !== "" ||
    elasticsearchUrl.password !== ""
  ) {
    throw new Error("invalid Elasticsearch URL for knowledge storage reset")
  }
  const targets = validateKnowledgeStorageResetTargets({
    primaryBucket: requiredEnvironmentValue(environment, "MINIO_BUCKET"),
    knowledgeBucket: requiredEnvironmentValue(
      environment,
      "MINIO_KNOWLEDGE_BUCKET",
    ),
    elasticsearchIndex: requiredEnvironmentValue(
      environment,
      "LINKSENSE_KB_ELASTICSEARCH_INDEX",
    ),
  })
  return {
    targets,
    minio: {
      endpoint,
      port,
      useSsl: useSslText === "true",
      region: requiredEnvironmentValue(environment, "MINIO_REGION"),
      accessKey: requiredEnvironmentValue(environment, "MINIO_ACCESS_KEY"),
      secretKey: requiredEnvironmentValue(environment, "MINIO_SECRET_KEY"),
    },
    elasticsearch: {
      url: elasticsearchUrl.href,
      username: requiredEnvironmentValue(
        environment,
        "LINKSENSE_KB_ELASTICSEARCH_USERNAME",
      ),
      password: requiredEnvironmentValue(
        environment,
        "LINKSENSE_KB_ELASTICSEARCH_PASSWORD",
      ),
    },
  }
}

export function getKnowledgeStorageResetConfirmation(
  targets: KnowledgeStorageResetTargets,
): string {
  const validated = validateKnowledgeStorageResetTargets(targets)
  return [
    RESET_CONFIRMATION_PREFIX,
    validated.knowledgeBucket,
    validated.elasticsearchIndex,
  ].join("::")
}

export function validateKnowledgeStorageResetTargets(
  targets: KnowledgeStorageResetTargets,
): KnowledgeStorageResetTargets {
  const primaryBucket = validateBucketName(targets.primaryBucket)
  const knowledgeBucket = validateBucketName(targets.knowledgeBucket)
  const elasticsearchIndex = validateIndexName(targets.elasticsearchIndex)
  if (
    primaryBucket === knowledgeBucket ||
    dangerousBucketNames.has(knowledgeBucket)
  ) {
    throw new Error("knowledge reset bucket is not an isolated safe target")
  }
  if (dangerousIndexNames.has(elasticsearchIndex)) {
    throw new Error("knowledge reset index is not an isolated safe target")
  }
  return { primaryBucket, knowledgeBucket, elasticsearchIndex }
}

export async function resetKnowledgeExternalStorage(input: {
  targets: KnowledgeStorageResetTargets
  command: KnowledgeStorageResetCommand
  minio: KnowledgeBucketResetClient
  elasticsearch: KnowledgeIndexResetClient
}): Promise<KnowledgeStorageResetResult> {
  const targets = validateKnowledgeStorageResetTargets(input.targets)
  const requiredConfirmation = getKnowledgeStorageResetConfirmation(targets)
  if (input.command.mode === "plan") {
    return {
      executed: false,
      knowledgeBucket: targets.knowledgeBucket,
      elasticsearchIndex: targets.elasticsearchIndex,
      requiredConfirmation,
    }
  }
  if (input.command.confirmation !== requiredConfirmation) {
    throw new Error("knowledge storage reset confirmation does not match")
  }

  const [bucketExists] = await Promise.all([
    input.minio.bucketExists(targets.knowledgeBucket),
    input.elasticsearch.ping(),
  ])
  if (!bucketExists) {
    throw new Error("configured knowledge bucket does not exist")
  }

  // Enumerate both namespaces before the first mutation. This verifies that the
  // configured credentials can observe the complete destructive scope.
  await countObjectVersions(input.minio, targets.knowledgeBucket)
  await countIncompleteUploads(input.minio, targets.knowledgeBucket)
  const indexExists = await input.elasticsearch.indexExists(
    targets.elasticsearchIndex,
  )

  const deletedIncompleteUploads = await deleteIncompleteUploads(
    input.minio,
    targets.knowledgeBucket,
  )
  const deletedObjectVersions = await deleteObjectVersions(
    input.minio,
    targets.knowledgeBucket,
  )
  await assertBucketEmpty(input.minio, targets.knowledgeBucket)

  if (indexExists) {
    await input.elasticsearch.deleteIndex(targets.elasticsearchIndex)
    if (
      await input.elasticsearch.indexExists(targets.elasticsearchIndex)
    ) {
      throw new Error("configured knowledge index still exists after deletion")
    }
  }

  return {
    executed: true,
    knowledgeBucket: targets.knowledgeBucket,
    elasticsearchIndex: targets.elasticsearchIndex,
    deletedObjectVersions,
    deletedIncompleteUploads,
    deletedElasticsearchIndex: indexExists,
  }
}

function validateBucketName(value: string): string {
  if (
    value !== value.trim() ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(value) ||
    value.includes("..") ||
    value.includes(".-") ||
    value.includes("-.") ||
    /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/u.test(value) ||
    hasDestructiveSelector(value)
  ) {
    throw new Error("invalid knowledge reset bucket target")
  }
  return value
}

function validateIndexName(value: string): string {
  if (
    value !== value.trim() ||
    value.length === 0 ||
    value.length > 255 ||
    !/^[a-z0-9][a-z0-9._-]*$/u.test(value) ||
    value.startsWith(".") ||
    value === "." ||
    value === ".." ||
    hasDestructiveSelector(value)
  ) {
    throw new Error("invalid knowledge reset index target")
  }
  return value
}

function hasDestructiveSelector(value: string): boolean {
  return (
    ["*", "?", "[", "]", "{", "}", ",", "\\", "/"].some((character) =>
      value.includes(character),
    ) ||
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0)!
      return codePoint <= 31 || codePoint === 127
    })
  )
}

async function countObjectVersions(
  client: KnowledgeBucketResetClient,
  bucket: string,
): Promise<number> {
  let count = 0
  for await (const object of client.listObjectVersions(bucket)) {
    validateObjectVersion(object)
    count = incrementSafeCount(count)
  }
  return count
}

async function countIncompleteUploads(
  client: KnowledgeBucketResetClient,
  bucket: string,
): Promise<number> {
  let count = 0
  for await (const upload of client.listIncompleteUploads(bucket)) {
    validateIncompleteUpload(upload)
    count = incrementSafeCount(count)
  }
  return count
}

async function deleteObjectVersions(
  client: KnowledgeBucketResetClient,
  bucket: string,
): Promise<number> {
  let deleted = 0
  let batch: Array<{ name: string; versionId?: string }> = []
  for await (const object of client.listObjectVersions(bucket)) {
    batch.push(validateObjectVersion(object))
    if (batch.length === DELETE_BATCH_SIZE) {
      await removeObjectVersionBatch(client, bucket, batch)
      deleted = incrementSafeCount(deleted, batch.length)
      batch = []
    }
  }
  if (batch.length > 0) {
    await removeObjectVersionBatch(client, bucket, batch)
    deleted = incrementSafeCount(deleted, batch.length)
  }
  return deleted
}

async function removeObjectVersionBatch(
  client: KnowledgeBucketResetClient,
  bucket: string,
  batch: Array<{ name: string; versionId?: string }>,
): Promise<void> {
  const results = await client.removeObjectVersions(bucket, batch)
  if (results.some((result) => result.error !== undefined)) {
    throw new Error("knowledge bucket rejected an object-version deletion")
  }
}

async function deleteIncompleteUploads(
  client: KnowledgeBucketResetClient,
  bucket: string,
): Promise<number> {
  let deleted = 0
  for await (const upload of client.listIncompleteUploads(bucket)) {
    const objectName = validateIncompleteUpload(upload)
    await client.removeIncompleteUpload(bucket, objectName)
    deleted = incrementSafeCount(deleted)
  }
  return deleted
}

async function assertBucketEmpty(
  client: KnowledgeBucketResetClient,
  bucket: string,
): Promise<void> {
  for await (const object of client.listObjectVersions(bucket)) {
    validateObjectVersion(object)
    throw new Error("knowledge bucket still contains object versions")
  }
  for await (const upload of client.listIncompleteUploads(bucket)) {
    validateIncompleteUpload(upload)
    throw new Error("knowledge bucket still contains incomplete uploads")
  }
}

function validateObjectVersion(
  object: KnowledgeBucketObjectVersion,
): { name: string; versionId?: string } {
  if (
    typeof object.name !== "string" ||
    object.name.length === 0 ||
    object.name.includes("\u0000") ||
    (object.versionId !== undefined &&
      (typeof object.versionId !== "string" ||
        object.versionId.length === 0 ||
        object.versionId.includes("\u0000")))
  ) {
    throw new Error("knowledge bucket returned an invalid object version")
  }
  return {
    name: object.name,
    ...(object.versionId === undefined
      ? {}
      : { versionId: object.versionId }),
  }
}

function validateIncompleteUpload(
  upload: KnowledgeBucketIncompleteUpload,
): string {
  if (
    typeof upload.key !== "string" ||
    upload.key.length === 0 ||
    upload.key.includes("\u0000")
  ) {
    throw new Error("knowledge bucket returned an invalid incomplete upload")
  }
  return upload.key
}

function incrementSafeCount(value: number, increment = 1): number {
  const result = value + increment
  if (!Number.isSafeInteger(result)) {
    throw new Error("knowledge storage reset item count is unsafe")
  }
  return result
}

function requiredEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  key: string,
): string {
  const value = environment[key]
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim()
  ) {
    throw new Error(`missing or invalid ${key} for knowledge storage reset`)
  }
  return value
}
