import { createServer } from "node:http";
import { describe, expect, it } from "vitest";

import {
  ElasticsearchKnowledgeAdapter,
  knowledgeIndexMappings,
} from "../src/modules/knowledge-processing/elasticsearch.js";

describe("knowledge index shutdown with the official Elasticsearch client", () => {
  it.each(["exists", "mapping", "count", "activation", "cleanup"])(
    "aborts the pending %s request instead of waiting for the network timeout",
    async (phase) => {
      let reached = () => {};
      const requestReached = new Promise<void>((resolve) => { reached = resolve; });
      const server = createServer((request, response) => {
        const current = request.method === "HEAD" ? "exists"
          : request.url?.includes("_mapping") ? "mapping"
          : request.url?.includes("_count") ? "count"
          : request.url?.includes("_update_by_query") ? "activation" : "cleanup";
        if (current === phase) { reached(); return; }
        response.setHeader("X-Elastic-Product", "Elasticsearch");
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(
          current === "mapping" ? { shutdown_test: { mappings: knowledgeIndexMappings(2) } }
            : current === "count" ? { count: 1 }
              : { timed_out: false, version_conflicts: 0, failures: [], updated: 1 },
        ));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test server port");
      const controller = new AbortController();
      const adapter = new ElasticsearchKnowledgeAdapter({
        url: `http://127.0.0.1:${address.port}`, username: "test", password: "test",
        index: "shutdown_test", dimensions: 2,
      });
      const operation = adapter.reconcileActiveDocumentVersion({
        knowledgeBaseId: "00000000-0000-4000-8000-000000000001",
        documentId: "00000000-0000-4000-8000-000000000002",
        activeDocumentVersionId: "00000000-0000-4000-8000-000000000003",
        expectedParentCount: 1, signal: controller.signal,
      });
      const failed = expect(operation).rejects.toBeInstanceOf(Error);
      try {
        await requestReached;
        controller.abort();
        await failed;
      } finally {
        controller.abort();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );
});
