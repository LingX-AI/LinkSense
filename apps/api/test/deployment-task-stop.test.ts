import { describe, expect, it, vi } from "vitest";

import {
  interruptDeploymentTasks,
  parseDeploymentStopCommand,
} from "../src/operations/deployment-task-stop.js";

const target = {
  conversationId: "c87154ac-3272-4aa4-80c7-9c1db072a3d9",
  ownerId: "6bfbf104-e8fb-4a15-9239-f09bf729f33a",
  turnId: "native-turn",
};

describe("deployment task interruption", () => {
  it("requires explicit confirmation that producers and execution containers have stopped before settlement", () => {
    expect(parseDeploymentStopCommand(["interrupt"])).toBe("interrupt");
    expect(parseDeploymentStopCommand(["settle", "--runtime-stopped"])).toBe(
      "settle",
    );
    expect(() => parseDeploymentStopCommand(["settle"])).toThrow();
    expect(() =>
      parseDeploymentStopCommand(["settle", "--runtime-stopped", "extra"]),
    ).toThrow();
  });

  it("interrupts all native turns concurrently without submitting or replaying a turn", async () => {
    const requests: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      requests.push(String(url));
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        "x-linksense-owner-id": target.ownerId,
      });
      expect(JSON.parse(String(init?.body))).toEqual({ turnId: "native-turn" });
      return Response.json({ code: "TURN_INTERRUPT_REQUESTED" });
    });
    const result = await interruptDeploymentTasks(
      [
        target,
        { ...target, conversationId: "32912445-a5d0-4fd4-bcb0-f3fb4a3a6d01" },
      ],
      {
        baseUrl: "http://runner:4001",
        secret: "test-only-secret",
        signal: AbortSignal.timeout(1_000),
        fetcher,
      },
    );
    expect(result).toEqual({ requested: 2, unavailable: 0 });
    expect(requests).toHaveLength(2);
    expect(requests.every((url) => url.endsWith("/turns/interrupt"))).toBe(
      true,
    );
  });

  it("uses one shared deadline for multiple unresponsive tasks and proceeds to forced shutdown", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    );
    const result = interruptDeploymentTasks([target, target, target], {
      baseUrl: "http://runner:4001",
      secret: "test-only-secret",
      signal: controller.signal,
      fetcher,
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    controller.abort();
    await expect(result).resolves.toEqual({ requested: 0, unavailable: 3 });
  });

  it("treats rejected or malformed interruption responses as unavailable, never as completed work", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ error_code: "RUNNER_UNAVAILABLE" }, { status: 503 }),
      )
      .mockResolvedValueOnce(Response.json({ success: true }));
    await expect(
      interruptDeploymentTasks([target, target], {
        baseUrl: "http://runner:4001",
        secret: "test-only-secret",
        signal: AbortSignal.timeout(1_000),
        fetcher,
      }),
    ).resolves.toEqual({ requested: 0, unavailable: 2 });
  });
});
