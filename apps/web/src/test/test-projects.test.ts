// @vitest-environment node

import { globSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import config from "../../vite.config"
import { sharedDomTests } from "./shared-dom-files"

const root = path.resolve(import.meta.dirname, "../..")

describe("test project boundaries", () => {
  it("isolates every project's module graph and global state between files", () => {
    for (const project of config.test?.projects ?? []) {
      if (typeof project !== "object" || !("test" in project)) continue
      expect(
        project.test?.isolate ?? config.test?.isolate ?? true,
        JSON.stringify(project.test?.name)
      ).toBe(true)
    }
  })

  it("runs every test file exactly once across the execution projects", () => {
    const files = globSync("src/**/*.test.{ts,tsx}", { cwd: root })
    const projects = config.test?.projects ?? []
    expect(projects.length).toBeGreaterThan(0)
    const projectFiles = projects.map((project) => {
      if (typeof project !== "object" || !("test" in project))
        return new Set<string>()
      return new Set(
        globSync(project.test?.include ?? [], {
          cwd: root,
          exclude: project.test?.exclude,
        })
      )
    })
    for (const file of files) {
      const matching = projectFiles.filter((project) => project.has(file))
      expect(matching, file).toHaveLength(1)
    }
  })

  it("keeps module-mocking tests out of the shared component environment", () => {
    for (const file of sharedDomTests) {
      const source = readFileSync(path.join(root, file), "utf8")
      expect(source, file).not.toMatch(
        /\bvi\.(?:mock|doMock|unmock|doUnmock|resetModules)\s*\(/u
      )
    }
  })
})
