import type { OfficeDocumentState } from "@/components/media/office-preview/office-preview.types"

const contentIdentities = new WeakMap<Uint8Array, number>()
let nextContentIdentity = 1

export function officeDocumentSessionKey(
  fileName: string,
  document: OfficeDocumentState
) {
  if (document.status !== "ready") return `${fileName}:${document.status}`

  let identity = contentIdentities.get(document.content)
  if (identity === undefined) {
    identity = nextContentIdentity
    nextContentIdentity += 1
    contentIdentities.set(document.content, identity)
  }
  return `${fileName}:ready:${identity}`
}
