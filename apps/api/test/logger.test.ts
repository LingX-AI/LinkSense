import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import pino from "pino";

import { ApiLogController, createLoggerOptions } from "../src/lib/logger.js";

describe("API logging", () => {
  it("keeps structured JSON output outside development", () => {
    const options = createLoggerOptions({ pretty: false });
    expect(options.transport).toBeUndefined();
    expect(options.timestamp).toBe(pino.stdTimeFunctions.isoTime);
  });

  it("renders development output through pino-pretty", () => {
    expect(createLoggerOptions({ pretty: true }).transport).toMatchObject({
      target: "pino-pretty",
    });
  });

  it("logs one completed request with sanitized path, status, and duration", async () => {
    const lines: Record<string, unknown>[] = [];
    const logger = pino(createLoggerOptions({ pretty: false }), {
      write(line: string) {
        lines.push(JSON.parse(line) as Record<string, unknown>);
      },
    });
    const app = Fastify({
      loggerInstance: logger,
      logController: new ApiLogController(),
    });
    app.get("/items", async () => ({ ok: true }));

    const response = await app.inject({
      method: "GET",
      url: "/items?token=secret",
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      service: "api",
      reqId: expect.any(String),
      method: "GET",
      url: "/items",
      statusCode: 200,
      msg: "request completed",
    });
    expect(typeof lines[0]?.time).toBe("string");
    expect(typeof lines[0]?.responseTime_ms).toBe("number");
    expect(JSON.stringify(lines[0])).not.toContain("secret");
  });

  it("does not log request query strings on missing routes", async () => {
    const lines: Record<string, unknown>[] = [];
    const logger = pino(createLoggerOptions({ pretty: false }), {
      write(line: string) {
        lines.push(JSON.parse(line) as Record<string, unknown>);
      },
    });
    const app = Fastify({
      loggerInstance: logger,
      logController: new ApiLogController(),
    });

    const response = await app.inject({
      method: "GET",
      url: "/missing?token=secret",
    });
    await app.close();

    expect(response.statusCode).toBe(404);
    expect(lines[0]).toMatchObject({
      method: "GET",
      url: "/missing",
      msg: "route not found",
    });
    expect(lines[1]).toMatchObject({
      url: "/missing",
      statusCode: 404,
      msg: "request completed",
    });
    expect(JSON.stringify(lines)).not.toContain("secret");
  });
});
