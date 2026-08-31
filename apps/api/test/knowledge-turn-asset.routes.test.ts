import { Readable } from "node:stream";

import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { KnowledgeTurnAssetReadService } from "../src/modules/knowledge/turn-asset-read.js";
import { knowledgeTurnAssetRoutes } from "../src/modules/knowledge/turn-asset-routes.js";

const ACTOR = {
  id: "00000000-0000-4000-8000-000000000001",
  role: "user" as const,
  status: "active" as const,
};
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000002";
const TURN_ID = "00000000-0000-4000-8000-000000000003";
const ASSET_ID = "00000000-0000-5000-8000-000000000004";
const apps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("knowledge turn asset routes", () => {
  it("streams a turn-authorized asset with private safe headers", async () => {
    const getAsset = vi.fn(async () => ({
      filename: "guide.png",
      mimeType: "image/png",
      sizeBytes: 3n,
      stream: Readable.from("png"),
    }));
    const app = Fastify();
    apps.push(app);
    await app.register(knowledgeTurnAssetRoutes, {
      service: { getAsset } as unknown as KnowledgeTurnAssetReadService,
      resolveActor: vi.fn(async () => ACTOR),
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: `/${CONVERSATION_ID}/turns/${TURN_ID}/knowledge-assets/${ASSET_ID}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(Buffer.from("png"));
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.headers["content-disposition"]).toContain("inline");
    expect(response.headers["content-security-policy"]).toBe(
      "default-src 'none'; sandbox",
    );
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(getAsset).toHaveBeenCalledWith(
      ACTOR,
      CONVERSATION_ID,
      TURN_ID,
      ASSET_ID,
    );
  });
});
