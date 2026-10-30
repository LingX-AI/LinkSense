import { createElement, MousePointer2 } from "lucide";
import { controlMessageSchema, reduceCursorMotion, type ControlMessage, type CursorPoint } from "./control-protocol.js";

declare const LINKSENSE_CONTROL_CSS: string;
declare global { interface Window { __linksenseControlInstalled?: boolean } }

function installControlView(): void {
  let host: HTMLDivElement | undefined;
  let surface: HTMLDivElement;
  let pointer: HTMLDivElement;
  let ripple: HTMLDivElement;
  let current: string | undefined;
  let lease: ReturnType<typeof setTimeout> | undefined;
  let expiresAt = 0;
  let movement: Animation | undefined;
  let point: CursorPoint = { x: 36, y: 72 };
  let feedback: Animation | undefined;
  // Offscreen animation clocks can be throttled; they must never delay native input.
  const reduced = () => reduceCursorMotion(document.visibilityState === "visible", matchMedia("(prefers-reduced-motion: reduce)").matches);
  const make = <T extends keyof HTMLElementTagNameMap>(tag: T, classes: string) => {
    const element = document.createElement(tag);
    element.className = classes;
    return element;
  };
  const hide = () => {
    clearTimeout(lease);
    movement?.cancel();
    feedback?.cancel();
    host?.remove();
    host = undefined;
    current = undefined;
  };
  const mount = () => {
    if (host?.isConnected) return;
    host = document.createElement("div");
    host.dataset.linksenseControl = "";
    host.setAttribute("aria-hidden", "true");
    const shadow = host.attachShadow({ mode: "open" });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(LINKSENSE_CONTROL_CSS);
    shadow.adoptedStyleSheets = [sheet];
    surface = make("div", "control-surface pointer-events-none fixed inset-0 m-0 h-screen w-screen max-h-none max-w-none overflow-visible border-0 bg-transparent p-0 font-sans text-sm text-foreground antialiased");
    surface.popover = "manual";
    const frame = make("div", "pointer-events-none fixed inset-0 rounded-sm ring-2 ring-control-pointer ring-inset");
    frame.dataset.linksenseFrame = "";
    frame.setAttribute("aria-hidden", "true");
    pointer = make("div", "pointer-events-none fixed top-0 left-0 size-0 text-control-pointer");
    pointer.dataset.linksenseCursor = "";
    pointer.setAttribute("aria-hidden", "true");
    const cursor = createElement(MousePointer2, { width: 28, height: 28, fill: "currentColor", stroke: "white", "stroke-width": 1.7, class: "absolute -top-1 -left-1 drop-shadow-md" });
    ripple = make("div", "absolute -top-4 -left-4 size-8 rounded-full border-2 border-control-pointer bg-control-pointer/15 opacity-0");
    pointer.append(ripple, cursor);
    pointer.hidden = true;
    surface.append(frame, pointer);
    shadow.append(surface);
    document.documentElement.append(host);
    surface.showPopover();
  };
  const apply = async (message: ControlMessage): Promise<boolean> => {
    if (message.action === "hide") {
      if (current === message.request_id) hide();
      return true;
    }
    if (message.action === "show") {
      mount();
      current = message.request_id;
      if (surface.matches(":popover-open")) surface.hidePopover();
      surface.showPopover();
    }
    if (!host?.isConnected || current !== message.request_id) return false;
    clearTimeout(lease);
    expiresAt = Date.now() + 45_000;
    lease = setTimeout(hide, 45_000);
    host.dataset.state = message.action === "idle" ? "idle" : "active";
    if (message.x !== undefined && message.y !== undefined) {
      const target = { x: message.x, y: message.y };
      pointer.hidden = false;
      pointer.dataset.x = String(target.x);
      pointer.dataset.y = String(target.y);
      movement?.cancel();
      if (message.action === "move" && message.duration > 0 && !reduced()) {
        movement = pointer.animate([
          { transform: `translate3d(${point.x}px,${point.y}px,0)` },
          { transform: `translate3d(${target.x}px,${target.y}px,0)` },
        ], { duration: message.duration, easing: "linear", fill: "forwards" });
        await movement.finished.catch(() => undefined);
      }
      if (!host?.isConnected || current !== message.request_id) return false;
      point = target;
      pointer.style.transform = `translate3d(${point.x}px,${point.y}px,0)`;
      movement?.cancel();
    }
    if (message.action === "click" && !reduced()) {
      feedback?.cancel();
      feedback = ripple.animate([
        { transform: "scale(.35)", opacity: .8 }, { transform: "scale(1.6)", opacity: 0 },
      ], { duration: 380, easing: "ease-out" });
    }
    return true;
  };
  chrome.runtime.onMessage.addListener((raw: unknown, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return false;
    const message = controlMessageSchema.safeParse(raw);
    if (!message.success) return false;
    void apply(message.data).then(applied => respond({ applied, reduced_motion: reduced() }), () => respond({ applied: false }));
    return true;
  });
  window.addEventListener("pagehide", hide);
  document.addEventListener("visibilitychange", () => {
    if (host && Date.now() >= expiresAt) hide();
    else if (document.visibilityState !== "visible" && movement?.playState === "running") movement.finish();
  });
}

if (!window.__linksenseControlInstalled) {
  window.__linksenseControlInstalled = true;
  installControlView();
}
