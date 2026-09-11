import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { skillDisplayNameSchema } from "@linksense/shared";
import { parseDocument } from "yaml";
import { z } from "zod";

import { AppError } from "../../lib/errors.js";

const interfaceSchema = z
  .object({
    interface: z
      .object({ display_name: skillDisplayNameSchema })
      .passthrough()
      .nullish(),
  })
  .passthrough()
  .nullable();

export async function readSkillDisplayName(
  packageRoot: string,
): Promise<string | null> {
  const filename = join(packageRoot, "agents", "openai.yaml");
  try {
    const info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 32_000) {
      throw new Error("invalid skill interface file");
    }
    const document = parseDocument(await readFile(filename, "utf8"), {
      prettyErrors: false,
    });
    if (document.errors.length > 0) {
      throw new Error("invalid skill interface YAML");
    }
    const value: unknown = document.toJS({ maxAliasCount: 32 });
    return interfaceSchema.parse(value)?.interface?.display_name ?? null;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw new AppError("INVALID_PACKAGE", {
      reason_code: "skill_display_name_invalid",
    });
  }
}
