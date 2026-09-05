// @vitest-environment node

import * as ts from "typescript"
import { describe, expect, it } from "vitest"

const selectConsumerSources = import.meta.glob(
  ["../../features/**/*.tsx", "../../pages/**/*.tsx"],
  {
    eager: true,
    import: "default",
    query: "?raw",
  }
) as Record<string, string>

function tagName(node: ts.JsxTagNameExpression): string {
  return node.getText()
}

function hasItemsAttribute(element: ts.JsxOpeningElement): boolean {
  return element.attributes.properties.some(
    (attribute) =>
      ts.isJsxAttribute(attribute) && attribute.name.getText() === "items"
  )
}

function hasRenderedChildren(element: ts.JsxElement): boolean {
  return element.children.some((child) => {
    if (ts.isJsxText(child)) return child.getText().trim().length > 0
    return true
  })
}

function closestSelect(node: ts.Node): ts.JsxElement | undefined {
  let parent = node.parent
  while (parent) {
    if (
      ts.isJsxElement(parent) &&
      tagName(parent.openingElement.tagName) === "Select"
    ) {
      return parent
    }
    parent = parent.parent
  }
  return undefined
}

function unlabeledSelectValues(path: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const violations: string[] = []

  function visit(node: ts.Node): void {
    const isEmptySelectValue =
      (ts.isJsxSelfClosingElement(node) &&
        tagName(node.tagName) === "SelectValue") ||
      (ts.isJsxElement(node) &&
        tagName(node.openingElement.tagName) === "SelectValue" &&
        !hasRenderedChildren(node))

    if (isEmptySelectValue) {
      const select = closestSelect(node)
      if (!select || !hasItemsAttribute(select.openingElement)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(
          node.getStart()
        )
        violations.push(`${path}:${line + 1}`)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return violations
}

describe("select label contract", () => {
  it("never renders a raw Select value when no explicit label is provided", () => {
    const violations = Object.entries(selectConsumerSources).flatMap(
      ([path, source]) => unlabeledSelectValues(path, source)
    )

    expect(violations).toEqual([])
  })
})
