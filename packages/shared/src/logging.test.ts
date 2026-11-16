import pino from "pino";
import { describe, expect, it } from "vitest";

import { createLoggerOptions, sanitizeRequestForLog } from "./logging.js";

describe("logging", () => {
  it("keeps structured JSON output with ISO timestamps outside development", () => {
    const options = createLoggerOptions({ service: "api", pretty: false });
    expect(options.transport).toBeUndefined();
    expect(options.timestamp).toBe(pino.stdTimeFunctions.isoTime);
    expect(options.formatters?.bindings?.({ pid: 1, hostname: "host" })).toMatchObject(
      { pid: 1, hostname: "host", service: "api" },
    );
  });

  it("renders development output through pino-pretty", () => {
    expect(
      createLoggerOptions({ service: "runner", pretty: true }).transport,
    ).toMatchObject({ target: "pino-pretty" });
  });

  it("strips query strings and private paths from request logs", () => {
    expect(
      sanitizeRequestForLog({ method: "GET", url: "/items?token=secret" }),
    ).toMatchObject({ method: "GET", url: "/items" });
    expect(
      sanitizeRequestForLog({
        method: "GET",
        url: `/html-preview/${"a".repeat(64)}/asset.js?private=value`,
      }).url,
    ).toBe("/html-preview/[redacted]/asset.js");
  });
});
