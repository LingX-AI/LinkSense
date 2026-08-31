import argon2 from "argon2"

export const ARGON2_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
  saltLength: 16,
  hashLength: 32,
})

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS)
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password)
}

let dummyHashPromise: Promise<string> | null = null

export function getDummyPasswordHash(): Promise<string> {
  dummyHashPromise ??= hashPassword("LinkSense-Dummy-Password1!")
  return dummyHashPromise
}
