import { Client as ElasticsearchClient } from "@elastic/elasticsearch"
import { Client as MinioClient } from "minio"

import {
  parseKnowledgeStorageResetArguments,
  parseKnowledgeStorageResetEnvironment,
  resetKnowledgeExternalStorage,
  type KnowledgeBucketIncompleteUpload,
  type KnowledgeBucketObjectVersion,
} from "../operations/knowledge-storage-reset.js"

async function main(): Promise<void> {
  const config = parseKnowledgeStorageResetEnvironment(process.env)
  const command = parseKnowledgeStorageResetArguments(process.argv.slice(2))
  const minio = new MinioClient({
    endPoint: config.minio.endpoint,
    port: config.minio.port,
    useSSL: config.minio.useSsl,
    accessKey: config.minio.accessKey,
    secretKey: config.minio.secretKey,
    region: config.minio.region,
  })
  const elasticsearch = new ElasticsearchClient({
    node: config.elasticsearch.url,
    auth: {
      username: config.elasticsearch.username,
      password: config.elasticsearch.password,
    },
  })

  const result = await resetKnowledgeExternalStorage({
    targets: config.targets,
    command,
    minio: {
      bucketExists: (bucket) => minio.bucketExists(bucket),
      listObjectVersions: (bucket) =>
        mapObjectVersions(
          minio.listObjects(bucket, "", true, { IncludeVersion: true }),
        ),
      removeObjectVersions: async (bucket, objects) =>
        (await minio.removeObjects(bucket, objects)).map((result) => ({
          ...(result?.Error === undefined ? {} : { error: result.Error }),
        })),
      listIncompleteUploads: (bucket) =>
        mapIncompleteUploads(
          minio.listIncompleteUploads(bucket, "", true),
        ),
      removeIncompleteUpload: (bucket, objectName) =>
        minio.removeIncompleteUpload(bucket, objectName),
    },
    elasticsearch: {
      ping: async () => {
        await elasticsearch.ping()
      },
      indexExists: (index) => elasticsearch.indices.exists({ index }),
      deleteIndex: async (index) => {
        await elasticsearch.indices.delete({ index })
      },
    },
  })

  process.stdout.write(`${JSON.stringify(result)}\n`)
}

async function* mapObjectVersions(
  objects: AsyncIterable<object>,
): AsyncIterable<KnowledgeBucketObjectVersion> {
  for await (const object of objects) {
    const name = Reflect.get(object, "name")
    const versionId = Reflect.get(object, "versionId")
    yield {
      ...(typeof name === "string" ? { name } : {}),
      ...(typeof versionId === "string" ? { versionId } : {}),
    }
  }
}

async function* mapIncompleteUploads(
  uploads: AsyncIterable<object>,
): AsyncIterable<KnowledgeBucketIncompleteUpload> {
  for await (const upload of uploads) {
    const key = Reflect.get(upload, "key")
    yield typeof key === "string" ? { key } : {}
  }
}

main().catch(() => {
  process.stderr.write(
    "Knowledge storage reset failed. No external error details were printed.\n",
  )
  process.exitCode = 1
})
