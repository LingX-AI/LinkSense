import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, expect, it } from "vitest"

import { readBrowserUserAgent } from "../src/browser/user-agent.js"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it("requires a validated Chrome UA from the browser runtime", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-ua-"))
  roots.push(root)
  await expect(readBrowserUserAgent(root)).rejects.toThrow()
  const userAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"
  await writeFile(path.join(root, "user-agent.json"), JSON.stringify({ userAgent }))
  await expect(readBrowserUserAgent(root)).resolves.toBe(userAgent)
  for (const invalid of [
    { userAgent: userAgent.replace("Chrome/", "HeadlessChrome/") },
    { userAgent: "invalid" },
    { userAgent: 123 },
    { userAgent, unexpected: true },
  ]) {
    await writeFile(path.join(root, "user-agent.json"), JSON.stringify(invalid))
    await expect(readBrowserUserAgent(root)).rejects.toThrow()
  }
})
