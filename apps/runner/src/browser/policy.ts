import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

export const MANAGED_BROWSER_POLICY_ROOT =
  "/tmp/linksense-browser-policy"
export const MANAGED_BROWSER_POLICY_FILE = "policy.json"

export type ManagedBrowserPolicy = {
  sessionRoot: string
  sessionLimit: number
}

export async function prepareManagedBrowserPolicy(
  policy: ManagedBrowserPolicy,
  root = MANAGED_BROWSER_POLICY_ROOT,
): Promise<void> {
  validateManagedBrowserPolicy(policy)
  await chmod(root, 0o755).catch((error: unknown) => {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error
  })
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { mode: 0o755 })
  const destination = path.join(root, MANAGED_BROWSER_POLICY_FILE)
  await writeFile(destination, `${JSON.stringify(policy)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o400,
  })
  await chmod(destination, 0o444)
  await chmod(root, 0o555)
}

export async function readManagedBrowserPolicy(
  root = MANAGED_BROWSER_POLICY_ROOT,
): Promise<ManagedBrowserPolicy> {
  const parsed = JSON.parse(
    await readFile(path.join(root, MANAGED_BROWSER_POLICY_FILE), "utf8"),
  ) as unknown
  validateManagedBrowserPolicy(parsed)
  return parsed
}

function validateManagedBrowserPolicy(
  value: unknown,
): asserts value is ManagedBrowserPolicy {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof (value as Record<string, unknown>).sessionRoot !== "string" ||
    !path.isAbsolute((value as Record<string, unknown>).sessionRoot as string) ||
    !Number.isInteger(
      (value as Record<string, unknown>).sessionLimit,
    ) ||
    ((value as Record<string, unknown>).sessionLimit as number) < 1 ||
    ((value as Record<string, unknown>).sessionLimit as number) > 20
  ) {
    throw new Error("invalid managed browser policy")
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
