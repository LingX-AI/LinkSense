import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import pino from "pino";

import { createLoggerOptions, RunnerLogController } from "../src/lib/logger.js";

describe("runner logging", () => {
  it("logs one completed request with sanitized path, status, and duration", async () => {
    const lines: Record<string, unknown>[] = [];
    const logger = pino(createLoggerOptions({ pretty: false }), {
      write(line: string) {
        lines.push(JSON.parse(line) as Record<string, unknown>);
      },
    });
    const app = Fastify({
      loggerInstance: logger,
      logController: new RunnerLogController(),
    });
    app.get("/health/live", async () => ({ ok: true }));

    const response = await app.inject({
      method: "GET",
      url: "/health/live?token=secret",
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      service: "runner",
      reqId: expect.any(String),
      method: "GET",
      url: "/health/live",
      statusCode: 200,
      msg: "request completed",
    });
    expect(typeof lines[0]?.responseTime_ms).toBe("number");
    expect(JSON.stringify(lines[0])).not.toContain("secret");
  });
});
