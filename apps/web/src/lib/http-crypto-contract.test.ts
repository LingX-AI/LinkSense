// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import ts from "typescript"
import { expect, it } from "vitest"

it("keeps browser entry points free of secure-context-only UUID and digest calls", () => {
  const root = path.resolve(import.meta.dirname, "..")
  const violations: string[] = []
  const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter(
    (file): file is string =>
      typeof file === "string" &&
      /\.tsx?$/u.test(file) &&
      !file.includes(".test.") &&
      !file.startsWith(`test${path.sep}`)
  )
  expect(files.length).toBeGreaterThan(0)
  for (const file of files) {
    const source = readFileSync(path.join(root, file), "utf8")
    if (!/randomUUID|subtle/u.test(source)) continue
    const parsed = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    )
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAccessExpression(node) &&
        (node.name.text === "randomUUID" ||
          (node.name.text === "subtle" &&
            /^(?:crypto|(?:window|self|globalThis)\.crypto)$/u.test(
              node.expression.getText(parsed)
            )))
      ) {
        violations.push(`${file}: ${node.getText(parsed)}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(parsed)
  }
  expect(violations).toEqual([])
})
