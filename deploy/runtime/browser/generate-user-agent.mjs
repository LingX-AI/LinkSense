import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function chromeUserAgent(nativeUserAgent) {
  if (
    typeof nativeUserAgent !== "string" ||
    !/^Mozilla\/5\.0 [\x20-\x7e]+ (?:Headless)?Chrome\/\d+\.\d+\.\d+\.\d+ Safari\/[\d.]+$/u.test(nativeUserAgent)
  ) {
    throw new Error("Invalid native Chromium user agent");
  }
  return nativeUserAgent.replace("HeadlessChrome/", "Chrome/");
}

export async function generateUserAgent(chromium, destination) {
  const browser = await chromium.launch({
    channel: "chromium",
    headless: true,
    chromiumSandbox: false,
    timeout: 30_000,
  });
  try {
    const page = await browser.newPage();
    const userAgent = chromeUserAgent(
      await page.evaluate(() => navigator.userAgent),
    );
    await writeFile(destination, `${JSON.stringify({ userAgent })}\n`, {
      mode: 0o444,
    });
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Resolve the existing CLI dependency through Node, independently of pnpm's
  // physical store layout. Probe only about:blank; no external page is loaded.
  const requireRuntime = createRequire(import.meta.url);
  const requireCli = createRequire(requireRuntime.resolve("@playwright/cli/package.json"));
  const { chromium } = requireCli("playwright");
  await generateUserAgent(chromium, fileURLToPath(new URL("./user-agent.json", import.meta.url)));
}
