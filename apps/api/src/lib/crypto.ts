import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto"

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}

export function hmacSha256(secret: string, namespace: string, value: string): string {
  return createHmac("sha256", secret).update(`${namespace}${value}`).digest("hex")
}

export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString("base64url")
}

function deriveAesKey(masterKey: string): Buffer {
  const decoded = Buffer.from(masterKey, "base64")
  if (decoded.byteLength === 32) return decoded
  return createHash("sha256").update(masterKey, "utf8").digest()
}

export function encryptJson(
  payload: unknown,
  masterKey: string,
  keyId: string,
  context?: string,
): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", deriveAesKey(masterKey), iv)
  cipher.setAAD(encryptionAssociatedData(keyId, context))
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return ["v1", keyId, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".")
}

export function decryptJson<T>(
  encrypted: string,
  masterKey: string,
  expectedKeyId: string,
  context?: string,
): T {
  const [version, keyId, ivValue, tagValue, ciphertextValue] = encrypted.split(".")
  if (!version || !keyId || !ivValue || !tagValue || !ciphertextValue || version !== "v1") {
    throw new Error("invalid encrypted credential envelope")
  }
  const expected = Buffer.from(expectedKeyId)
  const actual = Buffer.from(keyId)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("credential encryption key mismatch")
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveAesKey(masterKey),
    Buffer.from(ivValue, "base64url"),
  )
  decipher.setAAD(encryptionAssociatedData(keyId, context))
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ])
  return JSON.parse(plaintext.toString("utf8")) as T
}

function encryptionAssociatedData(keyId: string, context?: string): Buffer {
  return Buffer.from(context ? `${keyId}\0${context}` : keyId, "utf8")
}
