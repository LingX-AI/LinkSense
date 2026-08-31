import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = resolve(repositoryRoot, "apps/web");

export function resolveWebFormatTargets(arguments_) {
  if (arguments_.length === 0) return ["**/*.{ts,tsx}"];

  return arguments_.map((argument) => {
    const repositoryRelative = /^(?:apps|packages|scripts)\//u.test(argument);
    const absolutePath = isAbsolute(argument)
      ? resolve(argument)
      : resolve(repositoryRelative ? repositoryRoot : process.cwd(), argument);
    const relativePath = relative(webRoot, absolutePath);
    if (
      relativePath === "" ||
      relativePath === ".." ||
      relativePath.startsWith(`..${sep}`)
    ) {
      throw new Error(
        `拒绝格式化 apps/web 之外的文件：${argument}。请使用目标包自己的格式化或代码检查命令。`,
      );
    }
    return relativePath;
  });
}

export function runWebFormatter(arguments_) {
  const targets = resolveWebFormatTargets(arguments_);
  const prettierBinary = resolve(webRoot, "node_modules/.bin/prettier");
  if (!existsSync(prettierBinary)) {
    throw new Error("未找到 apps/web 的 Prettier，请先运行 pnpm install。");
  }

  const result = spawnSync(prettierBinary, ["--write", ...targets], {
    cwd: webRoot,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (entryUrl === import.meta.url) {
  try {
    runWebFormatter(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
