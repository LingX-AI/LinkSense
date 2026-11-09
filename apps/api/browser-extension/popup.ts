import { z } from "zod";
import { createIcons, Monitor, Link2, Check, Globe, MousePointer2, Unlink, CircleAlert, ShieldCheck, Unplug } from "lucide";

createIcons({ icons: { Monitor, Link2, Check, Globe, MousePointer2, Unlink, CircleAlert, ShieldCheck, Unplug }, attrs: { "stroke-width": 1.75 } });
const message = (name: string) => chrome.i18n.getMessage(name);
for (const element of document.querySelectorAll<HTMLElement>("[data-message]"))
  element.textContent = message(element.dataset.message ?? "");
document.documentElement.lang = chrome.i18n.getUILanguage();
document.title = message("extensionName");
const element = (id: string) => document.getElementById(id)!;
const status = element("status");
const origin = element("origin");
const error = element("error");
const connect = element("connect") as HTMLButtonElement;
const allow = element("allow") as HTMLButtonElement;
const release = element("release") as HTMLButtonElement;
const disconnect = element("disconnect") as HTMLButtonElement;
const newTabs = element("new-tabs") as HTMLInputElement;
const privacy = element("privacy-details") as HTMLDetailsElement;
const statusSchema = z.object({
  connected: z.boolean(), reconnecting: z.boolean().default(false),
  pending_origin: z.url().optional(), origin: z.url().optional(),
  allowed: z.boolean().default(false), can_allow: z.boolean().default(false),
  new_tabs: z.boolean().default(false), page_title: z.string().default(""), page_host: z.string().default(""),
});
let connectionOrigin: string | undefined;
let pending = false;
let busy = false;
let initialized = false;
function showError(show: boolean): void {
  error.textContent = show ? message("failed") : "";
  element("error-banner").hidden = !show;
}
async function refresh(): Promise<void> {
  const state = statusSchema.parse(await chrome.runtime.sendMessage({ type: "popup_status" }));
  const wasPending = pending;
  pending = Boolean(state.pending_origin);
  const connected = state.connected && !pending;
  const label = pending ? "pending" : connected ? "connected" : state.reconnecting ? "reconnecting" : "disconnected";
  status.textContent = message(label);
  element("connection-badge").dataset.state = label;
  connectionOrigin = state.pending_origin ?? state.origin;
  origin.textContent = connectionOrigin ? new URL(connectionOrigin).host : message("startFromSettings");
  origin.title = connectionOrigin ?? "";
  element("connection-hint").textContent = message(pending ? "confirmHint" : connected ? "automaticHint" : "disconnectedHint");
  connect.hidden = connected;
  connect.disabled = !connectionOrigin || busy || state.reconnecting;
  connect.setAttribute("aria-busy", String(busy));
  element("connect-label").textContent = message(pending ? "confirm" : "connect");
  element("page-card").hidden = !connected;
  element("page-title").textContent = state.page_title || message("currentPage");
  element("page-host").textContent = state.page_host;
  element("page-hint").textContent = message(state.allowed ? "sharedHint" : state.can_allow ? "pageHint" : "restrictedPage");
  element("page-shared").hidden = !state.allowed;
  allow.hidden = state.allowed;
  allow.disabled = busy || !connected || !state.can_allow;
  release.hidden = !state.allowed;
  release.disabled = busy || !connected;
  disconnect.hidden = !state.origin;
  disconnect.disabled = busy;
  element("new-tabs-option").hidden = !connected && !pending;
  newTabs.disabled = busy;
  if (!initialized || (!pending && !busy)) {
    newTabs.checked = state.new_tabs;
    initialized = true;
  }
  if (pending) privacy.open = true;
  else if (wasPending) privacy.open = false;
}
async function perform(type: string): Promise<void> {
  busy = true;
  showError(false);
  for (const button of [connect, allow, release, disconnect]) button.disabled = true;
  newTabs.disabled = true;
  try {
    const reply = z.object({ ok: z.boolean() }).parse(await chrome.runtime.sendMessage({
      type, new_tabs: newTabs.checked, origin: connectionOrigin,
    }));
    if (!reply.ok) showError(true);
  } catch { showError(true); }
  finally { busy = false; refreshStatus(); }
}
for (const [button, type] of [[connect, "connect"], [allow, "allow"], [release, "release"], [disconnect, "disconnect"]] as const)
  button.addEventListener("click", () => { void perform(type); });
newTabs.addEventListener("change", () => { if (!pending) void perform("preferences"); });
function refreshStatus(): void {
  void refresh().catch(() => showError(true));
}
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "session" || area === "local") refreshStatus();
});
chrome.tabs.onActivated.addListener(refreshStatus);
chrome.tabs.onUpdated.addListener((_id, change) => {
  if (change.url || change.title) refreshStatus();
});
refreshStatus();
