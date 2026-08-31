import {
  Ajv2020,
  type AnySchema,
  type ErrorObject,
} from "ajv/dist/2020.js"
import * as ajvFormatsModule from "ajv-formats"
import type { FormatsPlugin } from "ajv-formats"

import { DOCLING_DOCUMENT_V1_10_0_SCHEMA } from "./contracts/docling-document-v1.10.0.schema.js"
import { KnowledgeProcessingError } from "./errors.js"

export const DOCLING_DOCUMENT_SCHEMA_UPSTREAM_SHA256 =
  "ea0bdb4974e234ca4854335e5191f8cf9437fa26c35b4ea3e1eebf273f664a60"
export const DOCLING_DOCUMENT_SCHEMA_CANONICAL_SHA256 =
  "13a66c1b6a2717cc3e3f5490b02723aa20217224d5ed9f7a52e299000ff92769"
export const DOCLING_CORE_CONTRACT_TAG = "v2.87.1"
export const DOCLING_CORE_CONTRACT_COMMIT =
  "0215808e9b406f8b11ae02cacb1abb3c822df48b"

export type DoclingImageBearingCollection = Readonly<{
  propertyName: string
  containerKind: "array" | "record"
}>

const imageBearingCollections = discoverImageBearingCollections(
  DOCLING_DOCUMENT_V1_10_0_SCHEMA,
)
const runtimeSchema = normalizePydanticPatterns(
  DOCLING_DOCUMENT_V1_10_0_SCHEMA,
) as AnySchema
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  // Pydantic omits an explicit `type: "object"` on discriminator wrappers
  // whose `oneOf` branches already establish the object type.
  strictTypes: false,
})
resolveAjvFormatsPlugin(ajvFormatsModule)(ajv)
// Pydantic emits the non-standard `path` format for pathlib.Path. JSON Schema
// only defines the representation as a string, so no additional semantic
// restriction is available to a JavaScript validator.
ajv.addFormat("path", {
  type: "string",
  validate: () => true,
})

const validateDoclingDocument = ajv.compile(runtimeSchema)

export function validateDoclingDocumentSchema(
  input: unknown,
): readonly ErrorObject[] | null {
  if (validateDoclingDocument(input)) return null
  return validateDoclingDocument.errors ?? []
}

export function assertDoclingDocumentContract(
  input: unknown,
): asserts input is Record<string, unknown> {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Reflect.get(input, "schema_name") !== "DoclingDocument" ||
    Reflect.get(input, "version") !== "1.10.0"
  ) {
    throw new KnowledgeProcessingError("KNOWLEDGE_DOCLING_RESULT_INVALID")
  }
  const errors = validateDoclingDocumentSchema(input)
  if (errors !== null) {
    throw new KnowledgeProcessingError("KNOWLEDGE_DOCLING_RESULT_INVALID", {
      cause: errors,
    })
  }
}

export function canonicalDoclingDocumentSchemaJson(): string {
  return JSON.stringify(DOCLING_DOCUMENT_V1_10_0_SCHEMA)
}

/**
 * Returns every top-level DoclingDocument collection whose item schema
 * directly exposes an ImageRef. Deriving this from the pinned official schema
 * prevents asset ingestion from silently omitting newly supported structures.
 */
export function doclingImageBearingCollections(): readonly DoclingImageBearingCollection[] {
  return imageBearingCollections
}

function discoverImageBearingCollections(
  schema: unknown,
): readonly DoclingImageBearingCollection[] {
  const root = schemaObject(schema, "DoclingDocument")
  const properties = schemaObject(
    Reflect.get(root, "properties"),
    "DoclingDocument.properties",
  )
  const collections: DoclingImageBearingCollection[] = []

  for (const [propertyName, propertySchemaValue] of Object.entries(properties)) {
    if (!isSchemaObject(propertySchemaValue)) continue

    const itemSchema =
      propertySchemaValue.type === "array"
        ? Reflect.get(propertySchemaValue, "items")
        : propertySchemaValue.type === "object"
          ? Reflect.get(propertySchemaValue, "additionalProperties")
          : undefined
    if (
      !isSchemaObject(itemSchema) ||
      !schemaHasDirectProperty(itemSchema, root, "image", new Set())
    ) {
      continue
    }

    collections.push(
      Object.freeze({
        propertyName,
        containerKind:
          propertySchemaValue.type === "array" ? "array" : "record",
      }),
    )
  }

  if (collections.length === 0) {
    throw new Error(
      "Pinned DoclingDocument schema exposes no image-bearing collections",
    )
  }
  return Object.freeze(
    collections.sort((left, right) =>
      left.propertyName.localeCompare(right.propertyName),
    ),
  )
}

function schemaHasDirectProperty(
  schema: Record<string, unknown>,
  root: Record<string, unknown>,
  propertyName: string,
  seenReferences: ReadonlySet<string>,
): boolean {
  const reference = Reflect.get(schema, "$ref")
  if (typeof reference === "string") {
    if (seenReferences.has(reference)) return false
    const resolved = resolveLocalSchemaReference(root, reference)
    return (
      isSchemaObject(resolved) &&
      schemaHasDirectProperty(
        resolved,
        root,
        propertyName,
        new Set([...seenReferences, reference]),
      )
    )
  }

  const properties = Reflect.get(schema, "properties")
  if (isSchemaObject(properties) && Object.hasOwn(properties, propertyName)) {
    return true
  }

  for (const branchName of ["anyOf", "oneOf", "allOf"]) {
    const branches = Reflect.get(schema, branchName)
    if (
      Array.isArray(branches) &&
      branches.some(
        (branch) =>
          isSchemaObject(branch) &&
          schemaHasDirectProperty(
            branch,
            root,
            propertyName,
            seenReferences,
          ),
      )
    ) {
      return true
    }
  }
  return false
}

function resolveLocalSchemaReference(
  root: Record<string, unknown>,
  reference: string,
): unknown {
  if (!reference.startsWith("#/")) return undefined
  let current: unknown = root
  for (const rawToken of reference.slice(2).split("/")) {
    if (!isSchemaObject(current)) return undefined
    const token = rawToken.replaceAll("~1", "/").replaceAll("~0", "~")
    current = Reflect.get(current, token)
  }
  return current
}

function schemaObject(
  value: unknown,
  description: string,
): Record<string, unknown> {
  if (!isSchemaObject(value)) {
    throw new Error(`Missing schema object ${description}`)
  }
  return value
}

function isSchemaObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Pydantic's semantic-version pattern uses Python named-capture syntax
 * (`(?P<name>...)`). JSON Schema patterns use ECMA-262 and Ajv correctly
 * rejects that syntax. Removing only the capture names preserves the exact
 * accepted language while keeping the vendored upstream artifact byte-stable.
 */
function normalizePydanticPatterns(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizePydanticPatterns(entry))
  }
  if (typeof value !== "object" || value === null) return value

  const normalized: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    // Pydantic emits OpenAPI discriminator annotations with an explicit
    // mapping. Ajv's JSON Schema validator does not implement that mapping,
    // while the adjacent oneOf/const constraints already enforce the union.
    if (key === "discriminator") continue
    normalized[key] =
      key === "pattern" && typeof entry === "string"
        ? entry.replace(/\(\?P<[^>]+>/gu, "(?:")
        : normalizePydanticPatterns(entry)
  }
  return normalized
}

function resolveAjvFormatsPlugin(value: unknown): FormatsPlugin {
  if (typeof value === "function") return value as FormatsPlugin
  if (typeof value === "object" && value !== null) {
    const defaultExport = Reflect.get(value, "default")
    if (typeof defaultExport === "function") {
      return defaultExport as FormatsPlugin
    }
  }
  throw new TypeError("ajv-formats did not expose a callable plugin")
}
