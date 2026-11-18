import { AsyncLocalStorage } from "node:async_hooks";
import * as http from "node:http";
import * as https from "node:https";
import type { ClientOptions } from "minio";

export function createMinioTransport(useSsl: boolean): {
  transport: NonNullable<ClientOptions["transport"]>;
  run: <T>(signal: AbortSignal | undefined, request: () => Promise<T>) => Promise<T>;
} {
  const signals = new AsyncLocalStorage<AbortSignal | undefined>();
  const protocol = useSsl ? https : http;
  return {
    transport: {
      request(
        options: http.RequestOptions | URL | string,
        config?: http.RequestOptions | ((response: http.IncomingMessage) => void),
        callback?: (response: http.IncomingMessage) => void,
      ) {
        const signal = signals.getStore();
        if (typeof options === "string" || options instanceof URL) {
          return typeof config === "function"
            ? protocol.request(options, signal ? { signal } : {}, config)
            : protocol.request(options, { ...config, ...(signal && { signal }) }, callback);
        }
        return protocol.request({ ...options, ...(signal && { signal }) }, typeof config === "function" ? config : callback);
      },
    },
    async run(signal, request) {
      signal?.throwIfAborted();
      return signals.run(signal, request);
    },
  };
}
