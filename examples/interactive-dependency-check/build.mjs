import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { interactiveApplicationManifestSchema } from "../../packages/shared/dist/index.js";

const require = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const JSZip = require("jszip");
const source = fileURLToPath(new URL("./", import.meta.url));
const output = process.argv[2];
if (!output || !isAbsolute(output)) throw new Error("Pass an absolute output directory.");
const manifest = interactiveApplicationManifestSchema.parse(JSON.parse(await readFile(resolve(source, "manifest.json"), "utf8")));
await mkdir(output, { recursive: true });
for (const version of ["1.0.0", "1.1.0"]) {
  const next = structuredClone(manifest);
  next.version = version;
  if (version === "1.1.0") next.dependencies.knowledge_bases = [{ id: "ffffffff-5555-4555-8555-555555555555", name: "选择更新后的测试知识库" }];
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(interactiveApplicationManifestSchema.parse(next), null, 2));
  for (const name of ["index.html", "app.js", "styles.css"]) zip.file(name, await readFile(resolve(source, name)));
  const target = resolve(output, `interactive-dependency-check-${version}.zip`);
  await writeFile(target, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }), { flag: "wx" });
  console.log(target);
}
