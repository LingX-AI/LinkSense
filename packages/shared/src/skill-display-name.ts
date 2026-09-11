import { startCase } from "es-toolkit/string";
import { z } from "zod";

export const SKILL_DISPLAY_NAME_MAX_LENGTH = 64;

export const skillDisplayNameSchema = z
  .string()
  .trim()
  .max(SKILL_DISPLAY_NAME_MAX_LENGTH)
  .regex(/^[^\p{Cc}]*$/u)
  .nullable()
  .optional()
  .transform((value) => value || null);

export function formatSkillName(name: string): string {
  return name
    .split(":")
    .map((part) => startCase(part))
    .join(": ")
    .slice(0, SKILL_DISPLAY_NAME_MAX_LENGTH)
    .trimEnd();
}

export function skillDisplayName(
  name: string,
  displayName?: string | null,
): string {
  return displayName?.trim() || formatSkillName(name);
}

export function capabilityDisplayName(capability: {
  type: "skill" | "plugin";
  name: string;
  display_name?: string | null;
}): string {
  return capability.type === "skill"
    ? skillDisplayName(capability.name, capability.display_name)
    : capability.name;
}
