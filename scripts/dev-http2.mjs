import { connect } from "node:http2";

export function assertDevelopmentHttp2(origin, options = {}) {
  const url = new URL(origin);
  if (url.protocol !== "https:") throw new Error("HTTP/2 browser development requires an HTTPS origin");
  return new Promise((resolveProbe, rejectProbe) => {
    options.signal?.throwIfAborted();
    const session = connect(url.origin, options.ca ? { ca: options.ca } : {});
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      session.destroy();
      if (error) rejectProbe(error);
      else resolveProbe();
    };
    const abort = () => finish(options.signal.reason);
    const timer = setTimeout(() => finish(new Error("Development HTTP/2 probe timed out")), options.timeoutMs ?? 2_000);
    options.signal?.addEventListener("abort", abort, { once: true });
    session.on("error", finish);
    session.once("close", () => finish(new Error("Development HTTP/2 connection closed before a response")));
    session.once("connect", () => {
      if (session.alpnProtocol !== "h2") {
        finish(new Error("Development Web entry did not negotiate HTTP/2"));
        return;
      }
      const request = session.request({ ":path": "/", ":method": "HEAD" });
      request.on("error", finish);
      request.once("response", (headers) => {
        const status = headers[":status"];
        finish(status === 200 ? undefined : new Error(`Development HTTP/2 probe returned HTTP ${status}`));
      });
      request.end();
    });
  });
}
