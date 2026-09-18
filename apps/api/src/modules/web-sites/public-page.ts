import { createHash } from "node:crypto";
import type { Locale } from "@linksense/shared";
import { translateBackend } from "../../lib/i18n.js";

// Public error pages must render even when the application bundle is unavailable.
// Keep their small stylesheet self-contained and allow only its hash in CSP.
const styles = `
*{box-sizing:border-box}
html{color-scheme:light;background:#fff;color:#242424;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
body{margin:0}
main{min-height:100vh;min-height:100svh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 24px;text-align:center}
.code{margin:0 0 24px;color:#e5e7eb;font-size:clamp(104px,20vw,160px);font-weight:650;line-height:1;letter-spacing:-.065em;font-variant-numeric:tabular-nums;user-select:none}
h1{margin:0;font-size:22px;font-weight:600;line-height:1.4;letter-spacing:-.02em}
.description{max-width:36ch;margin:12px 0 0;color:#737373;font-size:14px;line-height:1.8;overflow-wrap:anywhere}
`;

export const siteNotFoundPolicy = `sandbox; default-src 'none'; style-src 'sha256-${createHash("sha256").update(styles).digest("base64")}'; base-uri 'none'; form-action 'none'`;

export function siteNotFoundPage(locale: Locale): string {
  const title = escapeHtml(translateBackend("webSitePage.notFoundTitle", locale));
  const description = escapeHtml(translateBackend("webSitePage.notFoundDescription", locale));
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>404 · ${title}</title>
<style>${styles}</style>
</head>
<body>
<main aria-labelledby="page-title">
<p class="code" aria-hidden="true">404</p>
<h1 id="page-title">${title}</h1>
<p class="description">${description}</p>
</main>
</body>
</html>`;
}

export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
