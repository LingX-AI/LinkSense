// @vitest-environment node

import { globSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import config from "../../vite.config"
import { sharedDomTests } from "./shared-dom-files"

const root = path.resolve(import.meta.dirname, "../..")

describe("test project boundaries", () => {
  it("runs every test file exactly once across the execution projects", () => {
    const files = globSync("src/**/*.test.{ts,tsx}", { cwd: root })
    const projects = config.test?.projects ?? []
    expect(projects.length).toBeGreaterThan(0)
    for (const file of files) {
      const matching = projects.filter((project) => {
        if (typeof project !== "object" || !("test" in project)) return false
        const test = project.test
        return (
          test?.include?.some((pattern) => path.matchesGlob(file, pattern)) &&
          !test.exclude?.some((pattern) => path.matchesGlob(file, pattern))
        )
      })
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
