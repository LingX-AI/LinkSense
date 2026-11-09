// Only fixed connection/settings actions and authorized task previews cross this bridge.
window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (
    event.source !== window ||
    event.origin !== location.origin ||
    window.top !== window
  )
    return;
  const data = event.data;
  if (
    !data ||
    typeof data !== "object" ||
    !("source" in data) ||
    data.source !== "linksense-web" ||
    !("type" in data) ||
    !("id" in data) ||
    typeof data.id !== "string" ||
    data.id.length > 100
  )
    return;
  if (typeof data.type !== "string" || !["detect", "pair", "preview", "activate", "open_extensions"].includes(data.type)) return;
  if (data.type === "open_extensions" && !location.pathname.endsWith("/settings/general")) return;
  if (
    data.type === "pair" &&
    (!("pairing" in data) || (!location.pathname.endsWith("/settings/general") && !("owner_id" in data)))
  )
    return;
  void chrome.runtime
    .sendMessage({
      type: data.type,
      ...("owner_id" in data ? { owner_id: data.owner_id } : {}),
      ...("automatic" in data ? { automatic: data.automatic } : {}),
      ...("resume" in data ? { resume: data.resume } : {}),
      ...("conversation_id" in data ? { conversation_id: data.conversation_id } : {}),
      ...("tab_id" in data ? { tab_id: data.tab_id } : {}),
      ...(data.type === "pair" && "pairing" in data
        ? { pairing: data.pairing }
        : {}),
    })
    .then(
      (result: unknown) =>
        window.postMessage(
          { source: "linksense-extension", id: data.id, result },
          location.origin,
        ),
      () =>
        window.postMessage(
          {
            source: "linksense-extension",
            id: data.id,
            result: { detected: false },
          },
          location.origin,
        ),
    );
});
chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message !== "object" ||
      !("type" in message) || message.type !== "linksense-reconnect") return;
  window.postMessage({ source: "linksense-extension", type: "reconnect" }, location.origin);
});
