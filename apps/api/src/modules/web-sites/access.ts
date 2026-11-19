import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Locale } from "@linksense/shared";
import { translateBackend } from "../../lib/i18n.js";
import { escapeHtml } from "./public-page.js";

// The passcode gate must render without the application bundle; keep the page
// self-contained, script-free and allow only its style hash in CSP.
const styles = `
*{box-sizing:border-box}
html{color-scheme:dark;background:#0a101c;color:#e8edf7;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
body{margin:0}
main{min-height:100vh;min-height:100svh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 24px;text-align:center}
.brand{display:flex;align-items:center;gap:9px;margin:0 0 32px;font-size:15px;font-weight:600;letter-spacing:-.01em}
.mark{display:grid;place-items:center;width:28px;height:28px;border-radius:9px;background:linear-gradient(135deg,#c8dcff,#6f9cf0);color:#0a101c;font-size:15px;font-weight:700;line-height:1}
h1{margin:0;font-size:22px;font-weight:600;line-height:1.4;letter-spacing:-.02em}
.description{max-width:36ch;margin:12px 0 0;color:#9aa6bc;font-size:14px;line-height:1.8}
form{display:flex;flex-direction:column;gap:12px;width:min(320px,100%);margin-top:28px}
label{font-size:13px;font-weight:500;text-align:left;color:#c6cede}
.field{position:relative;display:flex}
.field input{width:100%;height:42px;padding:0 46px 0 12px;border:1px solid #2a3447;border-radius:10px;background:#111a2a;color:#e8edf7;font-size:15px;outline:none}
.field input:focus-visible{border-color:#6f9cf0;box-shadow:0 0 0 3px rgba(111,156,240,.28)}
.toggle{position:absolute;top:4px;right:4px;width:34px;height:34px;border:0;border-radius:8px;background:transparent;color:#9aa6bc;cursor:pointer;display:grid;place-items:center}
.toggle:hover{color:#e8edf7;background:#1a2438}
.toggle .off{display:none}
.toggle[aria-pressed="true"] .on{display:none}
.toggle[aria-pressed="true"] .off{display:block}
button{height:42px;border:0;border-radius:10px;background:#8bb6ff;color:#0a101c;font-size:14px;font-weight:600;cursor:pointer}
button:hover{background:#a6c6ff}
.error{margin:0;color:#f1a4ae;font-size:13px}
`;

const styleHash = createHash("sha256").update(styles).digest("base64");

export function sitePasscodePolicy(script: string): string {
  const scriptHash = createHash("sha256").update(script).digest("base64");
  return `sandbox allow-forms allow-scripts; default-src 'none'; style-src 'sha256-${styleHash}'; script-src 'sha256-${scriptHash}'; form-action 'self'; base-uri 'none'`;
}

export const siteAccessCookiePrefix = "linksense_site_access_";

export function siteAccessCookieName(siteId: string): string {
  return `${siteAccessCookiePrefix}${siteId.replaceAll("-", "")}`;
}

/** Binds an unlock to the site and to the current passcode hash, so changing the passcode revokes access. */
export function siteAccessToken(secret: string, siteId: string, passcodeHash: string): string {
  return createHmac("sha256", secret).update(`site-access\0${siteId}\0${passcodeHash}`).digest("base64url");
}

const cookieValue = (cookieHeader: string | undefined, name: string): string | undefined => {
  const values = (cookieHeader ?? "").split(";").map(part => part.trim())
    .filter(part => part.startsWith(`${name}=`)).map(part => part.slice(name.length + 1));
  return values.length === 1 ? values[0] : undefined;
};

export function hasSiteAccess(
  cookieHeader: string | undefined,
  secret: string,
  site: { id: string; passcodeHash?: string | null },
): boolean {
  if (!site.passcodeHash) return true;
  const provided = cookieValue(cookieHeader, siteAccessCookieName(site.id));
  if (!provided) return false;
  const expected = siteAccessToken(secret, site.id, site.passcodeHash);
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function siteAccessCookie(secret: string, site: { id: string; passcodeHash: string }, options: { secure: boolean }): string {
  const maxAge = 30 * 24 * 60 * 60;
  // Release assets load in a sandboxed iframe, whose opaque origin is treated as
  // cross-site, so HTTPS needs SameSite=None; browsers reject that without Secure,
  // which plain-HTTP deployments (local, UAT) cannot provide. They fall back to
  // Lax: the shell and release documents still receive it, cross-site
  // subresources inside the frame cannot.
  const attributes = ["Path=/", "HttpOnly", options.secure ? "SameSite=None" : "SameSite=Lax",
    ...(options.secure ? ["Secure"] : []), `Max-Age=${maxAge}`];
  return `${siteAccessCookieName(site.id)}=${siteAccessToken(secret, site.id, site.passcodeHash)}; ${attributes.join("; ")}`;
}

/** Only same-site paths may be used as the post-unlock destination. */
export function safeAccessNext(value: string | null): string | undefined {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.length > 2_000) return undefined;
  return value;
}

export function sitePasscodePage(locale: Locale, input: { action: string; next?: string; incorrect?: boolean }): { html: string; policy: string } {
  const title = escapeHtml(translateBackend("webSitePage.passcodeTitle", locale));
  const description = escapeHtml(translateBackend("webSitePage.passcodeDescription", locale));
  const label = escapeHtml(translateBackend("webSitePage.passcodeLabel", locale));
  const submit = escapeHtml(translateBackend("webSitePage.passcodeSubmit", locale));
  const show = translateBackend("webSitePage.passcodeShow", locale);
  const hide = translateBackend("webSitePage.passcodeHide", locale);
  const incorrect = input.incorrect
    ? `<p class="error" role="alert">${escapeHtml(translateBackend("webSitePage.passcodeIncorrect", locale))}</p>`
    : "";
  const script = `(function(){var L=${JSON.stringify({ show, hide })},i=document.getElementById("passcode"),t=document.getElementById("passcode-toggle");if(!i||!t)return;t.addEventListener("click",function(){var v=i.type==="password";i.type=v?"text":"password";t.setAttribute("aria-pressed",String(v));t.setAttribute("aria-label",v?L.hide:L.show);i.focus();});})();`;
  const html = `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<style>${styles}</style>
</head>
<body>
<main aria-labelledby="page-title">
<p class="brand"><span class="mark" aria-hidden="true">L</span>LinkSense</p>
<h1 id="page-title">${title}</h1>
<p class="description">${description}</p>
<form method="post" action="${escapeHtml(input.action)}">
${input.next ? `<input type="hidden" name="next" value="${escapeHtml(input.next)}">` : ""}
<div class="field">
<input id="passcode" name="passcode" type="password" autocomplete="current-password" maxlength="128" required autofocus aria-label="${label}" placeholder="${label}">
<button type="button" id="passcode-toggle" class="toggle" aria-label="${escapeHtml(show)}" aria-pressed="false">
<svg class="on" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
<svg class="off" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 11s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="m2 2 20 20"/></svg>
</button>
</div>
${incorrect}
<button type="submit">${submit}</button>
</form>
</main>
<script>${script}</script>
</body>
</html>`;
  return { html, policy: sitePasscodePolicy(script) };
}
