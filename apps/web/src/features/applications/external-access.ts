import type {
  ApplicationExternalAccess,
  UpdateApplicationExternalAccessInput,
} from "@linksense/shared"

export function externalAccessSecurityConfigurationChanged(
  current: ApplicationExternalAccess,
  next: UpdateApplicationExternalAccessInput
) {
  return (
    current.enabled !== next.enabled ||
    current.auth_mode !== next.auth_mode ||
    current.allowed_origins.length !== next.allowed_origins.length ||
    current.allowed_origins.some(
      (origin, index) => origin !== next.allowed_origins[index]
    )
  )
}

export function externalIframeUrl(
  access: ApplicationExternalAccess,
  parentOrigin: string,
  locale: "zh-CN" | "en-US" = "zh-CN"
) {
  const url = new URL(access.iframe_url)
  url.searchParams.set("parent_origin", parentOrigin)
  url.searchParams.set("locale", locale)
  return url.toString()
}

export function externalIframeSnippet(
  access: ApplicationExternalAccess,
  parentOrigin: string,
  copy: { title: string; ticketComment: string },
  locale: "zh-CN" | "en-US" = "zh-CN"
) {
  const iframeUrl = externalIframeUrl(access, parentOrigin, locale)
  const frameOrigin = new URL(access.iframe_url).origin
  if (access.auth_mode === "public") {
    return `<iframe
  id="linksense-app"
  src="${iframeUrl}"
  sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
  allow="clipboard-write; microphone"
  style="width:100%;height:720px;border:0"
  title="${copy.title}"
></iframe>
<script>
  const frame = document.getElementById("linksense-app");
  function setLinkSenseLocale(locale) {
    frame.contentWindow.postMessage({
      type: "linksense:locale",
      appId: "${access.app_id}",
      locale
    }, "${frameOrigin}");
  }
</script>`
  }
  return `<iframe
  id="linksense-app"
  src="${iframeUrl}"
  sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
  allow="clipboard-write; microphone"
  style="width:100%;height:720px;border:0"
  title="${copy.title}"
></iframe>
<script>
  const frame = document.getElementById("linksense-app");
  function setLinkSenseLocale(locale) {
    frame.contentWindow.postMessage({
      type: "linksense:locale",
      appId: "${access.app_id}",
      locale
    }, "${frameOrigin}");
  }
  window.addEventListener("message", async (event) => {
    if (event.origin !== "${frameOrigin}" || event.source !== frame.contentWindow) return;
    if (event.data?.appId !== "${access.app_id}") return;
    if (event.data?.type !== "linksense:ready") return;
    // ${copy.ticketComment}
    const { ticket, sessionId } = await fetch("/your-backend/linksense-ticket", {
      method: "POST"
    }).then((response) => response.json());
    frame.contentWindow.postMessage({
      type: "linksense:ticket",
      appId: "${access.app_id}",
      ticket,
      ...(sessionId ? { sessionId } : {})
    }, "${frameOrigin}");
  });
</script>`
}
