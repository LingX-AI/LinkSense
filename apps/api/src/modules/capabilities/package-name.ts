import { z } from "zod"
import { builtInSkillNames } from "@linksense/shared"

const RESERVED_CAPABILITY_NAMES = new Set<string>(builtInSkillNames)

export const capabilityPackageNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
  .refine((name) => !RESERVED_CAPABILITY_NAMES.has(name))
