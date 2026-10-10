import { v4 as uuidV4 } from "uuid"

/** Generate a UUID with the same secure entropy on HTTP and HTTPS origins. */
export function createRandomUuid(): string {
  const browserCrypto = globalThis.crypto
  if (typeof browserCrypto?.getRandomValues !== "function") {
    throw new Error("Cryptographically secure random generation is unavailable")
  }
  // Supplying random bytes avoids the library's secure-context-only native
  // randomUUID path. UUID layout and version/variant bits remain library-owned.
  return uuidV4({ random: browserCrypto.getRandomValues(new Uint8Array(16)) })
}
