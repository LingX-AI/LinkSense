import { readFile } from "node:fs/promises"
import path from "node:path"

import { z } from "zod"

const browserIdentitySchema = z
  .object({
    userAgent: z
      .string()
      .max(512)
      .regex(
        /^Mozilla\/5\.0 [\x20-\x7e]+ Chrome\/\d+\.\d+\.\d+\.\d+ Safari\/[\d.]+$/u,
      )
      .refine((value) => !value.includes("HeadlessChrome")),
  })
  .strict()

export async function readBrowserUserAgent(runtimeRoot: string): Promise<string> {
  const identity: unknown = JSON.parse(
    await readFile(path.join(runtimeRoot, "user-agent.json"), "utf8"),
  )
  return browserIdentitySchema.parse(identity).userAgent
}
