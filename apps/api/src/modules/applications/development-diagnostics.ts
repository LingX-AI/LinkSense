import { parse, parseFragment, serialize } from "parse5";

const bootstrap = `(() => {
  let count = 0;
  const report = (message, file = "", line = 0) => {
    if (count++ >= 20) return;
    parent.postMessage({protocol:"linksense:development",type:"diagnostic",diagnostic:{message:String(message).slice(0,2000),file:String(file).slice(0,300),line:Number.isSafeInteger(line)?line:0}}, "*");
  };
  addEventListener("error", event => report(event.message || "Resource failed to load", event.filename || (event.target && (event.target.src || event.target.href)) || "", event.lineno || 0), true);
  addEventListener("unhandledrejection", event => report(event.reason instanceof Error ? event.reason.message : "Unhandled application operation"));
})();`;

export function instrumentApplicationPreview(html: string): string {
  const document = parse(html);
  const element = document.childNodes.find(node => node.nodeName === "html");
  if (!element || !("childNodes" in element)) return html;
  const head = element.childNodes.find(node => node.nodeName === "head");
  if (!head || !("childNodes" in head)) return html;
  const script = parseFragment(`<script>${bootstrap}</script>`).childNodes[0];
  if (script) { script.parentNode = head; head.childNodes.unshift(script); }
  return serialize(document);
}
