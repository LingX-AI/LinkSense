import { EventEmitter, once } from "node:events";
import { createServer } from "node:http";
import { afterEach, expect, it } from "vitest";
import { MinioObjectStorage } from "../src/adapters/object-storage.js";
import { KnowledgeObjectStore } from "../src/modules/knowledge-processing/object-store.js";
import { testConfig } from "./test-config.js";

const servers: ReturnType<typeof createServer>[] = [];
const documentKey = "knowledge-bases/10000000-0000-4000-8000-000000000001/documents/20000000-0000-4000-8000-000000000001/versions/30000000-0000-4000-8000-000000000001/display_markdown/40000000-0000-4000-8000-000000000001.md";
const assetKey = documentKey.replace("display_markdown/", "asset/").replace(/\.md$/u, ".png");

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve()),
    );
  }
});

it.each([
  ["range", "GET"],
  ["integrity stat", "HEAD"],
  ["integrity body", "GET"],
  ["image", "GET"],
  ["upload", "PUT"],
  ["cleanup", "DELETE"],
] as const)(
  "aborts a MinIO %s request before response headers are received",
  async (operation, method) => {
    const events = new EventEmitter<{ stalled: [method: string | undefined]; disconnected: [] }>();
    const stalled = once(events, "stalled");
    const disconnected = once(events, "disconnected");
    const server = createServer((request, reply) => {
      if (request.url?.endsWith("?location")) {
        reply.end("<LocationConstraint>us-east-1</LocationConstraint>");
        return;
      }
      if (operation === "integrity body" && request.method === "HEAD") {
        reply.setHeader("Content-Length", "5").end();
        return;
      }
      request.resume();
      reply.once("close", () => events.emit("disconnected"));
      events.emit("stalled", request.method);
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a loopback port");
    const config = testConfig({ MINIO_ENDPOINT: "127.0.0.1", MINIO_PORT: String(address.port) });
    const objectStore = new KnowledgeObjectStore({ ...config.minio, useSsl: false });
    const files = new MinioObjectStorage(config);
    const controller = new AbortController();
    const signal = controller.signal;
    const requests = {
      range: () => objectStore.getRangeStream(documentKey, 0, 5, signal),
      "integrity stat": () => objectStore.verifyIntegrity({ key: documentKey, expectedSha256: "a".repeat(64), expectedSizeBytes: 5, signal }),
      "integrity body": () => objectStore.verifyIntegrity({ key: documentKey, expectedSha256: "a".repeat(64), expectedSizeBytes: 5, signal }),
      image: () => objectStore.getStream(assetKey, signal),
      upload: () => files.putObject("fixture.png", Buffer.from("fixture"), {}, signal),
      cleanup: () => files.removeObject("fixture.png", signal),
    };
    const response = requests[operation]().then(() => null, (error: unknown) => error);
    await expect(stalled).resolves.toEqual([method]);
    controller.abort();
    await expect(response).resolves.toMatchObject({ name: "AbortError" });
    await disconnected;
  }, 2_000,
);
