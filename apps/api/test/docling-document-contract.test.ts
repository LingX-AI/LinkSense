import { createHash } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  DOCLING_CORE_CONTRACT_COMMIT,
  DOCLING_CORE_CONTRACT_TAG,
  DOCLING_DOCUMENT_SCHEMA_CANONICAL_SHA256,
  canonicalDoclingDocumentSchemaJson,
  doclingImageBearingCollections,
  validateDoclingDocumentSchema,
} from "../src/modules/knowledge-processing/docling-document-contract.js"

describe("pinned DoclingDocument contract", () => {
  it("keeps the vendored official schema byte-stable at runtime", () => {
    expect(DOCLING_CORE_CONTRACT_TAG).toBe("v2.87.1")
    expect(DOCLING_CORE_CONTRACT_COMMIT).toBe(
      "0215808e9b406f8b11ae02cacb1abb3c822df48b",
    )
    expect(
      createHash("sha256")
        .update(canonicalDoclingDocumentSchemaJson())
        .digest("hex"),
    ).toBe(DOCLING_DOCUMENT_SCHEMA_CANONICAL_SHA256)
  })

  it("accepts official nested table, graph, image, source, comment, and page structures", () => {
    expect(validateDoclingDocumentSchema(schemaFixture())).toBeNull()
  })

  it("pins every official top-level NodeItem collection without a LinkSense parser allowlist", () => {
    const discovered = discoverNodeItemCollections(officialSchema())
    expect([...discovered.keys()].sort()).toEqual(
      [
        "field_items",
        "field_regions",
        "form_items",
        "groups",
        "key_value_items",
        "pictures",
        "tables",
        "texts",
      ],
    )
    expect([...discovered.values()].every((labels) => labels.size > 0)).toBe(true)
  })

  it("discovers every image-bearing collection from the official schema", () => {
    expect(doclingImageBearingCollections()).toEqual([
      { propertyName: "form_items", containerKind: "array" },
      { propertyName: "key_value_items", containerKind: "array" },
      { propertyName: "pages", containerKind: "record" },
      { propertyName: "pictures", containerKind: "array" },
      { propertyName: "tables", containerKind: "array" },
      { propertyName: "texts", containerKind: "array" },
    ])
  })

  it.each([
    [
      "required text orig",
      (document: Record<string, unknown>) => {
        Reflect.deleteProperty(collection(document, "texts")[0]!, "orig")
      },
    ],
    [
      "forbidden item property",
      (document: Record<string, unknown>) => {
        Reflect.set(collection(document, "texts")[0]!, "alien", true)
      },
    ],
    [
      "complete table cell",
      (document: Record<string, unknown>) => {
        const table = collection(document, "tables")[0]!
        const data = objectProperty(table, "data")
        Reflect.deleteProperty(collection(data, "table_cells")[0]!, "text")
      },
    ],
    [
      "complete graph cell",
      (document: Record<string, unknown>) => {
        const item = collection(document, "key_value_items")[0]!
        const graph = objectProperty(item, "graph")
        Reflect.deleteProperty(collection(graph, "cells")[0]!, "orig")
      },
    ],
    [
      "formatting script enum",
      (document: Record<string, unknown>) => {
        const formatting = objectProperty(
          collection(document, "texts")[0]!,
          "formatting",
        )
        Reflect.set(formatting, "script", "sideways")
      },
    ],
    [
      "track source discriminator",
      (document: Record<string, unknown>) => {
        const source = collection(
          collection(document, "texts")[0]!,
          "source",
        )[0]!
        Reflect.set(source, "kind", "future-track")
      },
    ],
    [
      "fine reference range tuple",
      (document: Record<string, unknown>) => {
        const comment = collection(
          collection(document, "texts")[0]!,
          "comments",
        )[0]!
        Reflect.set(comment, "range", [0])
      },
    ],
    [
      "complete image reference",
      (document: Record<string, unknown>) => {
        Reflect.set(collection(document, "pictures")[0]!, "image", {
          uri: "artifacts/image.png",
        })
      },
    ],
    [
      "code language enum",
      (document: Record<string, unknown>) => {
        Reflect.set(
          collection(document, "texts")[1]!,
          "code_language",
          "ts",
        )
      },
    ],
    [
      "field value kind enum",
      (document: Record<string, unknown>) => {
        Reflect.set(collection(document, "texts")[2]!, "kind", "secret")
      },
    ],
    [
      "content layer enum",
      (document: Record<string, unknown>) => {
        Reflect.set(
          collection(document, "pictures")[0]!,
          "content_layer",
          "foreground",
        )
      },
    ],
  ])("rejects mutations outside the official schema: %s", (_name, mutate) => {
    const document = schemaFixture()
    mutate(document)
    expect(validateDoclingDocumentSchema(document)).not.toBeNull()
  })
})

function officialSchema(): Record<string, unknown> {
  const schema: unknown = JSON.parse(canonicalDoclingDocumentSchemaJson())
  if (!isObject(schema)) throw new Error("Official schema must be an object")
  return schema
}

function discoverNodeItemCollections(
  schema: Record<string, unknown>,
): ReadonlyMap<string, ReadonlySet<string>> {
  const properties = objectProperty(schema, "properties")
  const collections = new Map<string, ReadonlySet<string>>()

  for (const [propertyName, propertyValue] of Object.entries(properties)) {
    if (!isObject(propertyValue) || propertyValue.type !== "array") continue
    const items = Reflect.get(propertyValue, "items")
    if (!isObject(items) || !isNodeItemSchema(items, schema, new Set())) {
      continue
    }

    const labels = new Set<string>()
    collectNodeItemLabels(items, schema, new Set(), labels)
    if (labels.size === 0) {
      throw new Error(
        `Official NodeItem collection ${propertyName} exposes no labels`,
      )
    }
    collections.set(propertyName, labels)
  }

  return collections
}

function isNodeItemSchema(
  schema: Record<string, unknown>,
  root: Record<string, unknown>,
  seenReferences: ReadonlySet<string>,
): boolean {
  const reference = schema.$ref
  if (typeof reference === "string") {
    if (seenReferences.has(reference)) return false
    return isNodeItemSchema(
      schemaObject(resolveSchemaReference(root, reference), reference),
      root,
      new Set([...seenReferences, reference]),
    )
  }

  const properties = isObject(schema.properties)
    ? schema.properties
    : undefined
  const hasNodeItemShape =
    properties !== undefined &&
    ["self_ref", "parent", "children", "content_layer", "label"].every(
      (property) => Object.hasOwn(properties, property),
    )
  if (hasNodeItemShape) return true

  for (const unionKey of ["anyOf", "oneOf"]) {
    const branches = Reflect.get(schema, unionKey)
    if (!Array.isArray(branches) || branches.length === 0) continue
    return branches.every(
      (branch) =>
        isObject(branch) &&
        isNodeItemSchema(branch, root, new Set(seenReferences)),
    )
  }

  const intersections = schema.allOf
  return (
    Array.isArray(intersections) &&
    intersections.some(
      (branch) =>
        isObject(branch) &&
        isNodeItemSchema(branch, root, new Set(seenReferences)),
    )
  )
}

function collectNodeItemLabels(
  schema: Record<string, unknown>,
  root: Record<string, unknown>,
  seenReferences: Set<string>,
  labels: Set<string>,
): void {
  const reference = schema.$ref
  if (typeof reference === "string") {
    if (seenReferences.has(reference)) return
    seenReferences.add(reference)
    collectNodeItemLabels(
      schemaObject(resolveSchemaReference(root, reference), reference),
      root,
      seenReferences,
      labels,
    )
    return
  }

  if (isObject(schema.properties)) {
    const labelSchema = Reflect.get(schema.properties, "label")
    if (isObject(labelSchema)) {
      collectStringSchemaValues(labelSchema, root, new Set(), labels)
    }
  }
  for (const branchKey of ["anyOf", "oneOf", "allOf"]) {
    const branches = Reflect.get(schema, branchKey)
    if (!Array.isArray(branches)) continue
    for (const branch of branches) {
      if (!isObject(branch)) continue
      collectNodeItemLabels(branch, root, seenReferences, labels)
    }
  }
}

function collectStringSchemaValues(
  schema: Record<string, unknown>,
  root: Record<string, unknown>,
  seenReferences: Set<string>,
  values: Set<string>,
): void {
  const reference = schema.$ref
  if (typeof reference === "string") {
    if (seenReferences.has(reference)) return
    seenReferences.add(reference)
    collectStringSchemaValues(
      schemaObject(resolveSchemaReference(root, reference), reference),
      root,
      seenReferences,
      values,
    )
    return
  }

  if (typeof schema.const === "string") values.add(schema.const)
  if (Array.isArray(schema.enum)) {
    for (const value of schema.enum) {
      if (typeof value === "string") values.add(value)
    }
  }
  for (const branchKey of ["anyOf", "oneOf", "allOf"]) {
    const branches = Reflect.get(schema, branchKey)
    if (!Array.isArray(branches)) continue
    for (const branch of branches) {
      if (!isObject(branch)) continue
      collectStringSchemaValues(branch, root, seenReferences, values)
    }
  }
}

function resolveSchemaReference(
  root: Record<string, unknown>,
  reference: string,
): unknown {
  if (!reference.startsWith("#/")) return undefined
  let current: unknown = root
  for (const rawToken of reference.slice(2).split("/")) {
    if (!isObject(current)) return undefined
    const token = rawToken.replaceAll("~1", "/").replaceAll("~0", "~")
    current = Reflect.get(current, token)
  }
  return current
}

function schemaObject(
  value: unknown,
  description: string,
): Record<string, unknown> {
  if (!isObject(value)) {
    throw new Error(`Missing schema object ${description}`)
  }
  return value
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function schemaFixture(): Record<string, unknown> {
  const image = {
    mimetype: "image/png",
    dpi: 72,
    size: { width: 10, height: 20 },
    uri: "artifacts/image.png",
  }
  const provenance = {
    page_no: 1,
    charspan: [0, 4],
    bbox: {
      l: 0,
      t: 0,
      r: 10,
      b: 20,
      coord_origin: "TOPLEFT",
    },
  }
  const graph = {
    cells: [
      {
        label: "key",
        cell_id: 1,
        text: "Name",
        orig: "Name",
        prov: provenance,
        item_ref: { $ref: "#/texts/0" },
      },
      {
        label: "value",
        cell_id: 2,
        text: "Alice",
        orig: "Alice",
      },
    ],
    links: [
      {
        label: "to_value",
        source_cell_id: 1,
        target_cell_id: 2,
      },
    ],
  }
  return {
    schema_name: "DoclingDocument",
    version: "1.10.0",
    name: "official-structure-corpus",
    origin: {
      mimetype: "application/pdf",
      binary_hash: 42,
      filename: "fixture.pdf",
      uri: "https://example.test/fixture.pdf",
    },
    body: {
      self_ref: "#/body",
      parent: null,
      children: [],
      content_layer: "body",
      name: "_root_",
      label: "unspecified",
    },
    furniture: {
      self_ref: "#/furniture",
      parent: null,
      children: [],
      content_layer: "furniture",
      name: "_root_",
      label: "unspecified",
    },
    groups: [
      {
        self_ref: "#/groups/0",
        parent: null,
        children: [],
        content_layer: "body",
        name: "inline",
        label: "inline",
      },
    ],
    texts: [
      {
        self_ref: "#/texts/0",
        parent: null,
        children: [],
        content_layer: "body",
        label: "paragraph",
        orig: "Body",
        text: "Body",
        prov: [provenance],
        source: [
          {
            kind: "track",
            start_time: 1,
            end_time: 2,
            identifier: "cue-1",
            voice: "Speaker",
          },
        ],
        comments: [{ $ref: "#/texts/0", range: [0, 4] }],
        formatting: {
          bold: true,
          italic: false,
          underline: false,
          strikethrough: false,
          script: "baseline",
        },
        hyperlink: "https://example.test/policy",
      },
      {
        self_ref: "#/texts/1",
        parent: null,
        children: [],
        content_layer: "body",
        label: "code",
        orig: "const value = 1",
        text: "const value = 1",
        code_language: "TypeScript",
        captions: [],
        references: [],
        footnotes: [],
        image: null,
      },
      {
        self_ref: "#/texts/2",
        parent: null,
        children: [],
        content_layer: "body",
        label: "field_value",
        orig: "Alice",
        text: "Alice",
        kind: "fillable",
      },
    ],
    pictures: [
      {
        self_ref: "#/pictures/0",
        parent: null,
        children: [],
        content_layer: "body",
        label: "picture",
        prov: [provenance],
        captions: [],
        references: [],
        footnotes: [],
        image,
        annotations: [],
      },
    ],
    tables: [
      {
        self_ref: "#/tables/0",
        parent: null,
        children: [],
        content_layer: "body",
        label: "table",
        prov: [provenance],
        captions: [],
        references: [],
        footnotes: [],
        image: null,
        annotations: [],
        data: {
          num_rows: 1,
          num_cols: 1,
          orientation: "rot_0",
          table_cells: [
            {
              bbox: provenance.bbox,
              row_span: 1,
              col_span: 1,
              start_row_offset_idx: 0,
              end_row_offset_idx: 1,
              start_col_offset_idx: 0,
              end_col_offset_idx: 1,
              text: "Body",
              column_header: false,
              row_header: false,
              row_section: false,
              fillable: false,
              ref: { $ref: "#/texts/0" },
            },
          ],
        },
      },
    ],
    key_value_items: [
      {
        self_ref: "#/key_value_items/0",
        parent: null,
        children: [],
        content_layer: "body",
        label: "key_value_region",
        graph,
      },
    ],
    form_items: [
      {
        self_ref: "#/form_items/0",
        parent: null,
        children: [],
        content_layer: "body",
        label: "form",
        graph: {},
      },
    ],
    field_regions: [
      {
        self_ref: "#/field_regions/0",
        parent: null,
        children: [],
        content_layer: "body",
        label: "field_region",
      },
    ],
    field_items: [
      {
        self_ref: "#/field_items/0",
        parent: null,
        children: [],
        content_layer: "body",
        label: "field_item",
      },
    ],
    pages: {
      "1": {
        size: { width: 10, height: 20 },
        image,
        page_no: 1,
      },
    },
  }
}

function collection(
  value: Record<string, unknown>,
  property: string,
): Record<string, unknown>[] {
  const result = Reflect.get(value, property)
  if (!Array.isArray(result)) throw new Error(`Missing ${property} array`)
  return result as Record<string, unknown>[]
}

function objectProperty(
  value: Record<string, unknown>,
  property: string,
): Record<string, unknown> {
  const result = Reflect.get(value, property)
  if (typeof result !== "object" || result === null) {
    throw new Error(`Missing ${property} object`)
  }
  return result as Record<string, unknown>
}
