import { createServer } from "node:https"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

const [assetDirectoryArgument, portArgument, certificatePath, keyPath] =
  process.argv.slice(2)

if (
  !assetDirectoryArgument ||
  !portArgument ||
  !certificatePath ||
  !keyPath ||
  !/^\d{1,5}$/u.test(portArgument)
) {
  throw new Error(
    "usage: node scripts/serve-release-assets.mjs <asset-directory> <port> <certificate> <key>",
  )
}

const port = Number(portArgument)
if (port < 1 || port > 65_535) throw new Error("port is out of range")

const assetDirectory = path.resolve(assetDirectoryArgument)
const assetDirectoryStat = await stat(assetDirectory)
if (!assetDirectoryStat.isDirectory()) {
  throw new Error("asset directory is not a directory")
}

const server = createServer(
  {
    cert: await readFile(certificatePath),
    key: await readFile(keyPath),
  },
  async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" }).end()
        return
      }
      const requestUrl = new URL(request.url ?? "/", "https://127.0.0.1")
      const filename = decodeURIComponent(requestUrl.pathname.slice(1))
      if (!/^[A-Za-z0-9._-]+$/u.test(filename)) {
        response.writeHead(404).end()
        return
      }
      const file = path.join(assetDirectory, filename)
      const fileStat = await stat(file)
      if (!fileStat.isFile()) {
        response.writeHead(404).end()
        return
      }
      const body = await readFile(file)
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": body.byteLength,
        "Content-Type": "application/octet-stream",
      })
      response.end(request.method === "HEAD" ? undefined : body)
    } catch {
      response.writeHead(404).end()
    }
  },
)

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Serving release assets on https://127.0.0.1:${port}\n`)
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
