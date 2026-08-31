import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const baseEnvironment = { ...process.env, MPLBACKEND: "Agg" };
const workspaceRoot =
  process.env.LINKSENSE_SMOKE_WORKSPACE_ROOT || "/workspace";
const userHome = process.env.HOME?.trim();
assert.ok(userHome, "runtime smoke requires HOME");
const userARoot =
  process.env.LINKSENSE_SMOKE_USER_ROOT ||
  path.join(userHome, ".local", "share", "linksense");
const userBRoot =
  process.env.LINKSENSE_SMOKE_USER_B_ROOT || `${userARoot}-isolated-user-b`;
const taskOne = path.join(workspaceRoot, "task-a-1");
const taskTwo = path.join(workspaceRoot, "task-a-2");
const taskB = path.join(workspaceRoot, "task-b-1");
const outputDirectory = path.join(taskOne, "artifacts");
const toolBin = requiredEnvironment("LINKSENSE_RUNTIME_TOOL_BIN");
const pythonWrapper = path.join(toolBin, "linksense-uv");
const nodeWrapper = path.join(toolBin, "linksense-pnpm");
const publicPythonSite = requiredEnvironment(
  "LINKSENSE_PYTHON_BASE_SITE_PACKAGES",
);
const publicNodeProject = requiredEnvironment("LINKSENSE_NODE_BASE_PROJECT");
const pythonPackageIndex = requiredEnvironment(
  "LINKSENSE_PYTHON_PACKAGE_INDEX_URL",
);
const nodePackageRegistry = requiredEnvironment(
  "LINKSENSE_NODE_PACKAGE_REGISTRY_URL",
);

await Promise.all([
  mkdir(taskOne, { recursive: true }),
  mkdir(taskTwo, { recursive: true }),
  mkdir(taskB, { recursive: true }),
  mkdir(outputDirectory, { recursive: true }),
]);

if (process.env.LINKSENSE_SMOKE_EXPECT_UID) {
  assert.equal(
    (await run("id", ["-u"], { cwd: taskOne })).stdout.trim(),
    process.env.LINKSENSE_SMOKE_EXPECT_UID,
  );
}
if (process.env.LINKSENSE_SMOKE_EXPECT_GID) {
  assert.equal(
    (await run("id", ["-g"], { cwd: taskOne })).stdout.trim(),
    process.env.LINKSENSE_SMOKE_EXPECT_GID,
  );
}

await assertCommandMatrix();
assert.equal(await resolveCommand("linksense-uv"), pythonWrapper);
assert.equal(await resolveCommand("linksense-pnpm"), nodeWrapper);

const protectedFiles = [
  path.join(publicPythonSite, "openpyxl", "__init__.py"),
  path.join(publicNodeProject, "package.json"),
];
const protectedHashes = await Promise.all(protectedFiles.map(sha256));
if (process.env.LINKSENSE_SMOKE_EXPECT_IMMUTABLE === "1") {
  for (const target of [
    path.dirname(path.dirname(path.dirname(publicPythonSite))),
    publicNodeProject,
    toolBin,
  ]) {
    await assertNotWritable(target);
  }
}

await exerciseShellTools();
await run(pythonWrapper, ["pip", "list"], {
  cwd: taskOne,
  env: baseEnvironment,
});
await exercisePythonRuntime(baseEnvironment);
await exerciseNodeRuntime(baseEnvironment);

const pythonWheel = await createPythonFixture(taskOne);
const nodeTarball = await createNodeFixture(taskOne);
await Promise.all([
  run(pythonWrapper, ["pip", "install", pythonWheel], {
    cwd: taskOne,
    env: baseEnvironment,
  }),
  run(pythonWrapper, ["pip", "install", pythonWheel], {
    cwd: taskTwo,
    env: baseEnvironment,
  }),
]);
await Promise.all([
  run(nodeWrapper, ["add", nodeTarball], {
    cwd: taskOne,
    env: baseEnvironment,
  }),
  run(nodeWrapper, ["add", nodeTarball], {
    cwd: taskTwo,
    env: baseEnvironment,
  }),
]);
await assertFixtureImports(baseEnvironment, taskOne, true);
await assertFixtureImports(baseEnvironment, taskTwo, true);

const userBEnvironment = environmentForUserRoot(baseEnvironment, userBRoot);
await run(pythonWrapper, ["pip", "list"], {
  cwd: taskB,
  env: userBEnvironment,
});
await run(nodeWrapper, ["list"], {
  cwd: taskB,
  env: userBEnvironment,
});
await assertPublicImports(userBEnvironment, taskB);
await assertFixtureImports(userBEnvironment, taskB, false);

await runAllowFailure(pythonWrapper, ["pip", "uninstall", "-y", "openpyxl"], {
  cwd: taskTwo,
  env: baseEnvironment,
});
await runAllowFailure(nodeWrapper, ["remove", "exceljs"], {
  cwd: taskTwo,
  env: baseEnvironment,
});
await assertPublicImports(baseEnvironment, taskTwo);

for (const args of [
  ["pip", "install", "--system", "blocked-package"],
  [
    "pip",
    "install",
    "--python",
    path.join(
      path.dirname(path.dirname(path.dirname(publicPythonSite))),
      "bin",
      "python",
    ),
    "blocked-package",
  ],
  ["pip", "install", "--prefix", taskOne, "blocked-package"],
  [
    "pip",
    "install",
    "-i",
    "https://blocked.example.test/simple/",
    "blocked-package",
  ],
  [
    "pip",
    "install",
    "--index-url=https://blocked.example.test/simple/",
    "blocked-package",
  ],
  [
    "pip",
    "install",
    "--default-index",
    "https://blocked.example.test/simple/",
    "blocked-package",
  ],
  [
    "pip",
    "install",
    "--extra-index-url=https://blocked.example.test/simple/",
    "blocked-package",
  ],
  [
    "pip",
    "install",
    "--index",
    "https://blocked.example.test/simple/",
    "blocked-package",
  ],
  [
    "pip",
    "install",
    "--index-strategy",
    "unsafe-best-match",
    "blocked-package",
  ],
  [
    "pip",
    "install",
    "--find-links",
    "https://blocked.example.test/",
    "blocked-package",
  ],
  ["pip", "install", "--no-index", "blocked-package"],
  ["pip", "install", "--torch-backend", "cu128", "blocked-package"],
  ["pip", "install", "--torch-backend=cu128", "blocked-package"],
  ["pip", "install", "-r", path.join(taskOne, "requirements.txt")],
  [
    "pip",
    "install",
    "--constraints",
    path.join(taskOne, "constraints.txt"),
    "blocked-package",
  ],
]) {
  await expectExitCode(pythonWrapper, args, 2, baseEnvironment, taskOne);
}
for (const args of [
  ["--dir", taskOne, "add", "blocked-package"],
  ["-g", "add", "blocked-package"],
  ["--global-dir", taskOne, "add", "blocked-package"],
  ["add", "--registry", "https://blocked.example.test/", "blocked-package"],
  ["add", "--registry=https://blocked.example.test/", "blocked-package"],
  ["add", "--config.registry=https://blocked.example.test/", "blocked-package"],
  [
    "add",
    "--config.@blocked:registry=https://blocked.example.test/",
    "@blocked/package",
  ],
  [
    "add",
    "--config.userconfig",
    path.join(taskOne, "blocked-user.npmrc"),
    "blocked-package",
  ],
  ["--reporter=silent", "add", "blocked-package"],
  ["config", "set", "registry", "https://blocked.example.test/"],
]) {
  await expectExitCode(nodeWrapper, args, 2, baseEnvironment, taskOne);
}
const projectNpmrc = path.join(userARoot, "node", ".npmrc");
await writeFile(
  projectNpmrc,
  "@blocked:registry=https://scoped-bypass.example.invalid/\n",
);
await expectExitCode(
  nodeWrapper,
  ["add", "@blocked/package"],
  2,
  baseEnvironment,
  taskOne,
);
await rm(projectNpmrc, { force: true });

assert.deepEqual(
  await Promise.all(protectedFiles.map(sha256)),
  protectedHashes,
  "shared runtime files changed during user dependency operations",
);
await Promise.all([
  assertMissing(path.join(userARoot, "python", ".linksense-uv.lock.d")),
  assertMissing(path.join(userARoot, "node", ".linksense-pnpm.lock.d")),
]);

if (process.env.LINKSENSE_SMOKE_OFFICE === "1") {
  await exerciseOfficeConversion();
}
if (process.env.LINKSENSE_SMOKE_NETWORK === "1") {
  for (const endpoint of [pythonPackageIndex, nodePackageRegistry]) {
    await run(
      "curl",
      [
        "--fail",
        "--silent",
        "--show-error",
        "--location",
        endpoint,
        "--output",
        "/dev/null",
      ],
      { cwd: taskOne },
    );
  }
}

console.log(
  JSON.stringify({
    status: "ok",
    python: "shared imports, file round-trips, persistent install, isolation",
    node: "shared imports, file round-trips, persistent install, isolation",
    office: process.env.LINKSENSE_SMOKE_OFFICE === "1",
    immutable: process.env.LINKSENSE_SMOKE_EXPECT_IMMUTABLE === "1",
  }),
);

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function run(command, args, options = {}) {
  return execFileAsync(command, args, {
    cwd: options.cwd || taskOne,
    env: options.env || baseEnvironment,
    maxBuffer: 20 * 1024 * 1024,
    timeout: options.timeout || 120_000,
  });
}

async function runAllowFailure(command, args, options = {}) {
  try {
    return await run(command, args, options);
  } catch (error) {
    return error;
  }
}

async function expectExitCode(command, args, expected, environment, cwd) {
  let caught;
  try {
    await run(command, args, { cwd, env: environment });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `${command} ${args.join(" ")} unexpectedly succeeded`);
  assert.equal(caught.code, expected);
}

async function resolveCommand(name) {
  const result = await run("/bin/sh", ["-c", 'command -v "$1"', "sh", name]);
  return result.stdout.trim();
}

async function assertCommandMatrix() {
  const portable = [
    "sh",
    "env",
    "pwd",
    "mkdir",
    "rm",
    "cp",
    "mv",
    "ln",
    "find",
    "xargs",
    "sort",
    "sed",
    "awk",
    "grep",
    "rg",
    "cut",
    "tr",
    "head",
    "tail",
    "wc",
    "date",
    "tar",
    "gzip",
    "git",
    "curl",
    "file",
    "zip",
    "unzip",
    "python",
    "python3",
    "uv",
    "node",
    "pnpm",
    "codex",
    "linksense-uv",
    "linksense-pnpm",
  ];
  const productionOnly = [
    "bash",
    "jq",
    "fc-list",
    "libreoffice",
    "pdfinfo",
    "pdftoppm",
    "gcc",
    "g++",
    "make",
    "pkg-config",
    "flock",
    "sha256sum",
  ];
  for (const command of [
    ...portable,
    ...(process.env.LINKSENSE_SMOKE_PRODUCTION === "1" ? productionOnly : []),
  ]) {
    assert.ok(await resolveCommand(command), `missing command: ${command}`);
  }
  if (process.env.LINKSENSE_SMOKE_PRODUCTION === "1") {
    const charmap = await run("locale", ["charmap"]);
    assert.equal(charmap.stdout.trim().toUpperCase(), "UTF-8");
    const fonts = await run("fc-list", [":lang=zh"]);
    assert.ok(fonts.stdout.trim(), "no Chinese font is discoverable");
  }
}

async function exerciseShellTools() {
  const repository = path.join(taskOne, "shell-probe");
  await mkdir(repository, { recursive: true });
  await writeFile(path.join(repository, "中文.txt"), "LinkSense 命令验证\n");
  await run("git", ["init", "--quiet"], { cwd: repository });
  const status = await run(
    "git",
    ["-c", "core.quotePath=false", "status", "--short"],
    { cwd: repository },
  );
  assert.match(status.stdout, /中文\.txt/u);
  const search = await run("rg", ["命令验证", repository]);
  assert.match(search.stdout, /LinkSense 命令验证/u);
  const archive = path.join(taskOne, "shell-probe.zip");
  await run("zip", ["-q", "-r", archive, "shell-probe"], { cwd: taskOne });
  const extracted = path.join(taskOne, "unzipped");
  await mkdir(extracted, { recursive: true });
  await run("unzip", ["-q", archive, "-d", extracted]);
  assert.equal(
    await readFile(path.join(extracted, "shell-probe", "中文.txt"), "utf8"),
    "LinkSense 命令验证\n",
  );
}

async function assertPublicImports(environment, cwd) {
  const python = await run(
    "python",
    ["-c", "import openpyxl,pptx,PIL; print(openpyxl.__file__)"],
    { cwd, env: environment },
  );
  assert.ok(
    path
      .resolve(python.stdout.trim())
      .startsWith(path.resolve(publicPythonSite)),
  );
  await run(
    "node",
    [
      "--input-type=module",
      "-e",
      'await import("exceljs"); await import("pptxgenjs"); await import("sharp")',
    ],
    { cwd, env: environment },
  );
}

async function exercisePythonRuntime(environment) {
  const script = path.join(taskOne, "python-runtime-smoke.py");
  await writeFile(
    script,
    `from pathlib import Path
import importlib, json, sys
from datetime import date
modules = ("bs4", "docx", "httpx", "jinja2", "lxml", "matplotlib", "numpy", "openpyxl", "pandas", "pdfplumber", "PIL", "pptx", "pypdf", "reportlab", "requests", "xlsxwriter", "yaml")
for name in modules: importlib.import_module(name)
from docx import Document
from matplotlib import pyplot as plt
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font
from pandas import DataFrame, read_csv, read_excel
from PIL import Image
from pptx import Presentation
from pptx.util import Inches
from pypdf import PdfReader
from reportlab.pdfgen.canvas import Canvas
out = Path(${JSON.stringify(outputDirectory)})
out.mkdir(parents=True, exist_ok=True)
image_path = out / "image.png"
Image.new("RGB", (96, 64), "#4f8cff").save(image_path)
assert Image.open(image_path).size == (96, 64)
workbook_path = out / "workbook.xlsx"
wb = Workbook(); ws = wb.active; ws["A1"] = "中文标题"; ws["A1"].font = Font(bold=True); ws["B2"] = date(2026, 7, 15); ws["C2"] = "=1+1"; wb.save(workbook_path)
assert load_workbook(workbook_path, data_only=False).active["A1"].value == "中文标题"
presentation_path = out / "report.pptx"
deck = Presentation(); slide = deck.slides.add_slide(deck.slide_layouts[6]); slide.shapes.add_textbox(Inches(1), Inches(1), Inches(5), Inches(1)).text = "LinkSense 中文 PPT"; slide.shapes.add_picture(str(image_path), Inches(1), Inches(2)); deck.save(presentation_path)
assert len(Presentation(presentation_path).slides) == 1
document_path = out / "letter.docx"
doc = Document(); doc.add_heading("LinkSense 中文文档", 0); doc.add_paragraph("round trip"); doc.save(document_path)
assert "round trip" in Document(document_path).paragraphs[-1].text
pdf_path = out / "report.pdf"
canvas = Canvas(str(pdf_path)); canvas.drawString(72, 720, "LinkSense PDF"); canvas.save(); assert len(PdfReader(pdf_path).pages) == 1
frame = DataFrame([{"name": "张三", "score": 98}, {"name": "李四", "score": 97}])
csv_path = out / "data.csv"; frame.to_csv(csv_path, index=False); assert len(read_csv(csv_path)) == 2
pandas_xlsx = out / "pandas.xlsx"; frame.to_excel(pandas_xlsx, index=False); assert len(read_excel(pandas_xlsx)) == 2
plot_path = out / "plot.png"; plt.figure(); plt.plot([1, 2], [3, 4]); plt.savefig(plot_path); plt.close(); assert plot_path.stat().st_size > 0
assert Path(sys.prefix).resolve() == Path(${JSON.stringify(path.join(userARoot, "python", ".venv"))}).resolve()
print(json.dumps({"status": "ok", "files": 8}))
`,
  );
  const result = await run("python", [script], {
    cwd: taskOne,
    env: environment,
  });
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    status: "ok",
    files: 8,
  });
}

async function exerciseNodeRuntime(environment) {
  const script = path.join(taskOne, "node-runtime-smoke.mjs");
  await writeFile(
    script,
    `import assert from "node:assert/strict";
import { createWriteStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ZipArchive } from "archiver";
import ExcelJS from "exceljs";
import PptxGenJS from "pptxgenjs";
import sharp from "sharp";
import { Document, Packer, Paragraph } from "docx";
import { PDFDocument } from "pdf-lib";
const packages = ["archiver", "axios", "cheerio", "csv-parse", "csv-stringify", "dayjs", "docx", "exceljs", "fast-xml-parser", "glob", "pdf-lib", "pptxgenjs", "sharp", "yaml", "zod"];
for (const name of packages) await import(name);
const out = ${JSON.stringify(outputDirectory)};
const bookPath = path.join(out, "node-workbook.xlsx");
const book = new ExcelJS.Workbook(); book.addWorksheet("数据").addRow(["中文", 42]); await book.xlsx.writeFile(bookPath); const loaded = new ExcelJS.Workbook(); await loaded.xlsx.readFile(bookPath); assert.equal(loaded.worksheets[0].getCell("A1").value, "中文");
const deckPath = path.join(out, "node-report.pptx"); const deck = new PptxGenJS(); deck.addSlide().addText("Node 中文 PPT", {x:1,y:1,w:5,h:1}); await deck.writeFile({fileName: deckPath});
const docPath = path.join(out, "node-letter.docx"); await writeFile(docPath, await Packer.toBuffer(new Document({sections:[{children:[new Paragraph("Node 中文文档")]}]})));
const pdf = await PDFDocument.create(); pdf.addPage(); const pdfBytes = await pdf.save(); const pdfPath = path.join(out, "node-report.pdf"); await writeFile(pdfPath, pdfBytes); assert.equal((await PDFDocument.load(await readFile(pdfPath))).getPageCount(), 1);
const pngPath = path.join(out, "node-image.png"); await sharp({create:{width:80,height:50,channels:4,background:"#22aa88ff"}}).resize(40,25).png().toFile(pngPath); const metadata = await sharp(pngPath).metadata(); assert.equal(metadata.width, 40);
const archivePath = path.join(out, "node-artifacts.zip"); await new Promise((resolve, reject) => { const output = createWriteStream(archivePath); const archive = new ZipArchive(); output.on("close", resolve); output.on("error", reject); archive.on("error", reject); archive.pipe(output); archive.file(bookPath, {name:"workbook.xlsx"}); archive.file(deckPath, {name:"report.pptx"}); void archive.finalize(); });
console.log(JSON.stringify({status:"ok", files:6}));
`,
  );
  const result = await run("node", [script], {
    cwd: taskOne,
    env: environment,
  });
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    status: "ok",
    files: 6,
  });
  await run("unzip", ["-t", path.join(outputDirectory, "node-artifacts.zip")]);
  await run(
    "node",
    ["-e", 'require("exceljs"); require("sharp"); require("dayjs")'],
    { cwd: taskOne, env: environment },
  );
}

async function createPythonFixture(workspace) {
  const stage = path.join(workspace, "python-wheel-stage");
  const packageDirectory = path.join(stage, "linksense_runtime_smoke");
  const metadataDirectory = path.join(
    stage,
    "linksense_runtime_smoke-1.0.0.dist-info",
  );
  await Promise.all([
    mkdir(packageDirectory, { recursive: true }),
    mkdir(metadataDirectory, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(packageDirectory, "__init__.py"),
      'VALUE = "persistent-python-user-a"\n',
    ),
    writeFile(
      path.join(metadataDirectory, "METADATA"),
      "Metadata-Version: 2.1\nName: linksense-runtime-smoke\nVersion: 1.0.0\n",
    ),
    writeFile(
      path.join(metadataDirectory, "WHEEL"),
      "Wheel-Version: 1.0\nGenerator: linksense-smoke\nRoot-Is-Purelib: true\nTag: py3-none-any\n",
    ),
    writeFile(path.join(metadataDirectory, "RECORD"), ""),
  ]);
  const wheel = path.join(
    workspace,
    "linksense_runtime_smoke-1.0.0-py3-none-any.whl",
  );
  const builder = path.join(workspace, "build-wheel.py");
  await writeFile(
    builder,
    `import pathlib, sys, zipfile
source, destination = map(pathlib.Path, sys.argv[1:])
with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
    for item in source.rglob("*"):
        if item.is_file(): archive.write(item, item.relative_to(source))
`,
  );
  await run("python3", [builder, stage, wheel], { cwd: workspace });
  return wheel;
}

async function createNodeFixture(workspace) {
  const fixtureRoot = path.join(workspace, "node-package-fixture");
  const packageRoot = path.join(fixtureRoot, "package");
  await mkdir(packageRoot, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(packageRoot, "package.json"),
      JSON.stringify({
        name: "@linksense/runtime-smoke",
        version: "1.0.0",
        type: "module",
        exports: "./index.js",
      }),
    ),
    writeFile(
      path.join(packageRoot, "index.js"),
      'export const value = "persistent-node-user-a";\n',
    ),
  ]);
  const tarball = path.join(workspace, "linksense-runtime-smoke-1.0.0.tgz");
  await run("tar", ["-czf", tarball, "-C", fixtureRoot, "package"], {
    cwd: workspace,
  });
  return tarball;
}

async function assertFixtureImports(environment, cwd, expected) {
  const python = run(
    "python",
    [
      "-c",
      'import linksense_runtime_smoke; assert linksense_runtime_smoke.VALUE == "persistent-python-user-a"',
    ],
    { cwd, env: environment },
  );
  const node = run(
    "node",
    [
      "--input-type=module",
      "-e",
      'const module = await import("@linksense/runtime-smoke"); if (module.value !== "persistent-node-user-a") process.exit(2)',
    ],
    { cwd, env: environment },
  );
  if (expected) {
    await Promise.all([python, node]);
  } else {
    const outcomes = await Promise.allSettled([python, node]);
    assert.deepEqual(
      outcomes.map((outcome) => outcome.status),
      ["rejected", "rejected"],
    );
  }
}

function environmentForUserRoot(source, root) {
  const pythonEnvironment = path.join(root, "python", ".venv");
  const nodeProject = path.join(root, "node");
  const pnpmHome = path.join(root, "pnpm-home");
  const cacheRoot = path.join(root, "cache");
  const sourcePath = (source.PATH || "").split(path.delimiter);
  const filteredPath = sourcePath.filter(
    (entry) =>
      entry && !path.resolve(entry).startsWith(path.resolve(userARoot)),
  );
  return {
    ...source,
    PATH: [
      toolBin,
      path.join(pythonEnvironment, "bin"),
      path.join(nodeProject, "node_modules", ".bin"),
      pnpmHome,
      ...filteredPath,
    ].join(path.delimiter),
    VIRTUAL_ENV: pythonEnvironment,
    UV_PROJECT_ENVIRONMENT: pythonEnvironment,
    UV_CACHE_DIR: path.join(cacheRoot, "uv"),
    PNPM_HOME: pnpmHome,
    npm_config_store_dir: path.join(cacheRoot, "pnpm", "store"),
    NPM_CONFIG_PREFIX: pnpmHome,
    COREPACK_HOME: path.join(cacheRoot, "corepack"),
    XDG_CACHE_HOME: cacheRoot,
    TMPDIR: path.join(root, "tmp"),
    LINKSENSE_USER_PYTHON_ROOT: path.join(root, "python"),
    LINKSENSE_USER_PYTHON_VENV: pythonEnvironment,
    LINKSENSE_USER_NODE_PROJECT: nodeProject,
    NODE_PATH: [
      path.join(nodeProject, "node_modules"),
      path.join(publicNodeProject, "node_modules"),
    ].join(path.delimiter),
  };
}

async function exerciseOfficeConversion() {
  const officeOutput = path.join(taskOne, "office-pdf");
  const officeProfile = path.join(taskOne, "libreoffice-profile");
  await Promise.all([
    mkdir(officeOutput, { recursive: true }),
    mkdir(officeProfile, { recursive: true }),
  ]);
  const profileUrl = `file://${officeProfile}`;
  for (const filename of ["workbook.xlsx", "report.pptx", "letter.docx"]) {
    await run(
      "libreoffice",
      [
        "--headless",
        `-env:UserInstallation=${profileUrl}`,
        "--convert-to",
        "pdf",
        "--outdir",
        officeOutput,
        path.join(outputDirectory, filename),
      ],
      { cwd: taskOne, timeout: 180_000 },
    );
  }
  const pdf = path.join(officeOutput, "report.pdf");
  await run("pdfinfo", [pdf]);
  await run(
    "pdftoppm",
    ["-f", "1", "-singlefile", "-png", pdf, path.join(officeOutput, "page")],
    { timeout: 180_000 },
  );
  assert.ok((await stat(path.join(officeOutput, "page.png"))).size > 0);
}

async function sha256(target) {
  const result = await run("python3", [
    "-c",
    "import hashlib,pathlib,sys; print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())",
    target,
  ]);
  return result.stdout.trim();
}

async function assertNotWritable(target) {
  await assert.rejects(access(target, constants.W_OK));
}

async function assertMissing(target) {
  await assert.rejects(access(target));
}
