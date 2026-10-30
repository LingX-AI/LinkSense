import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { test } from "node:test"

const requireApi = createRequire(new URL("../apps/api/package.json", import.meta.url))
const minioPath = requireApi.resolve("minio")
const requireMinio = createRequire(minioPath)
const queryStringPath = requireMinio.resolve("query-string")

test("MinIO query parsing handles many distinct encoded runs without blocking the process", () => {
  const result = spawnSync(process.execPath, ["--input-type=commonjs", "-e", `
    const assert = require("node:assert/strict");
    const queryString = require(${JSON.stringify(queryStringPath)});
    let input = "";
    for (let index = 0; index < 32_000; index++) {
      const high = Math.floor(index / 256).toString(16).padStart(2, "0");
      const low = (index % 256).toString(16).padStart(2, "0");
      input += "%" + high + "%" + low + "x";
    }
    const decoded = queryString.parse("value=" + input + "%zz").value;
    assert.ok(decoded.endsWith("%zz"));
    assert.ok(decoded.length > 0);
  `], { encoding: "utf8", timeout: 5_000 })
  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, 0, result.stderr)
})

test("MinIO query parsing preserves Unicode, malformed escapes and one-level decoding", () => {
  const queryString = requireMinio("query-string")
  assert.deepEqual({ ...queryString.parse("name=%E6%96%87%E6%A1%A3+one&bad=%FF&once=%25C2%zz") }, {
    name: "文档 one", bad: "%FF", once: "%C2%zz",
  })
  assert.equal(queryString.stringify({ name: "文档 + 100%", absent: undefined }), "name=%E6%96%87%E6%A1%A3%20%2B%20100%25")
})

test("the real MinIO client signs Unicode object names and response parameters without network access", async () => {
  const { Client } = requireApi("minio")
  const client = new Client({
    endPoint: "storage.example.com", useSSL: true, region: "us-east-1",
    accessKey: "fixture", secretKey: "fixture",
  })
  const objectName = "文档/report + 100%.pdf"
  const disposition = 'attachment; filename="report + 100%.pdf"'
  const signed = new URL(await client.presignedGetObject(
    "fixture-bucket", objectName, 300,
    { "response-content-disposition": disposition }, new Date("2026-01-01T00:00:00Z"),
  ))
  assert.equal(decodeURIComponent(signed.pathname), `/fixture-bucket/${objectName}`)
  assert.equal(signed.searchParams.get("response-content-disposition"), disposition)
  assert.equal(signed.searchParams.get("X-Amz-Expires"), "300")
  assert.match(signed.searchParams.get("X-Amz-Signature"), /^[0-9a-f]{64}$/u)
})
