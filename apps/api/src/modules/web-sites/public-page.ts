import { createHash } from "node:crypto";
import type { Locale } from "@linksense/shared";
import { translateBackend } from "../../lib/i18n.js";

// Public error pages must render even when the application bundle is unavailable.
// Keep their small stylesheet self-contained, script-free and only its hash in CSP.
const styles = `
*{box-sizing:border-box}
html{color-scheme:dark;background:#0a101c;color:#e8edf7;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
body{margin:0}
main{position:relative;min-height:100vh;min-height:100svh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 24px;text-align:center;overflow:hidden}
.orb{position:absolute;border-radius:50%;filter:blur(64px);pointer-events:none;will-change:transform}
.orb-a{width:min(54vw,520px);aspect-ratio:1;top:-14%;left:-10%;background:#3b6fd4;opacity:.5;animation:drift-a 16s ease-in-out infinite alternate}
.orb-b{width:min(46vw,430px);aspect-ratio:1;right:-8%;bottom:-18%;background:#8bb6ff;opacity:.32;animation:drift-b 19s ease-in-out infinite alternate}
@keyframes drift-a{from{transform:translate3d(0,0,0) scale(1)}to{transform:translate3d(16%,12%,0) scale(1.12)}}
@keyframes drift-b{from{transform:translate3d(0,0,0) scale(1.06)}to{transform:translate3d(-14%,-10%,0) scale(.94)}}
.brand{position:relative;display:flex;align-items:center;gap:9px;margin:0 0 44px;font-size:15px;font-weight:600;letter-spacing:-.01em}
.mark{display:grid;place-items:center;width:28px;height:28px;border-radius:9px;background:linear-gradient(135deg,#c8dcff,#6f9cf0);color:#0a101c;font-size:15px;font-weight:700;line-height:1}
.code{position:relative;margin:0;font-size:clamp(112px,25vw,208px);font-weight:650;line-height:.9;letter-spacing:-.07em;font-variant-numeric:tabular-nums;user-select:none;color:#f2f6ff;animation:float 6s ease-in-out infinite}
h1{position:relative;margin:8px 0 0;font-size:22px;font-weight:600;line-height:1.4;letter-spacing:-.02em}
.description{position:relative;max-width:36ch;margin:12px 0 0;color:#9aa6bc;font-size:14px;line-height:1.8;overflow-wrap:anywhere}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
@media (prefers-reduced-motion:reduce){.orb,.code{animation:none}}
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
<meta name="robots" content="noindex, nofollow">
<title>404 · ${title}</title>
<style>${styles}</style>
</head>
<body>
<main aria-labelledby="page-title">
<span class="orb orb-a" aria-hidden="true"></span>
<span class="orb orb-b" aria-hidden="true"></span>
<p class="brand"><span class="mark" aria-hidden="true">L</span>LinkSense</p>
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
