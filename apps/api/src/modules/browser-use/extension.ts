import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import JSZip from "jszip";
import { AppError } from "../../lib/errors.js";

export async function browserExtensionZip(): Promise<Buffer> {
  // Both src/ and dist/ resolve to the build-generated extension in dist/.
  const apiRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const compiledRoot = path.join(apiRoot, "dist", "browser-extension");
  const zip = new JSZip();
  try {
    for (const file of await readdir(compiledRoot, {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!file.isFile()) continue;
      const filename = path.join(file.parentPath, file.name);
      zip.file(
        path.relative(compiledRoot, filename).split(path.sep).join("/"),
        await readFile(filename),
      );
    }
    if (!zip.file("manifest.json") || !zip.file("background.js"))
      throw new Error("extension build missing");
    return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } catch {
    throw new AppError("SERVICE_TEMPORARILY_UNAVAILABLE");
  }
}
