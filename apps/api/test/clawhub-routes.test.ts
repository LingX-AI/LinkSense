import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sendAppError } from "../src/lib/http.js";
import { clawHubRoutes } from "../src/modules/clawhub/routes.js";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const SKILL_ID = "20000000-0000-4000-8000-000000000001";
const apps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("ClawHub routes", () => {
  it("maps validated local catalog search and pagination", async () => {
    const service = fakeService();
    const app = await createApp(service);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/clawhub/skills?search=agent&limit=12&cursor=opaque",
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(service.listCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER_ID, status: "active" }),
      {
        search: "agent",
        sort: "downloads",
        limit: 12,
        cursor: "opaque",
      },
    );
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        items: [{ id: SKILL_ID }],
        next_cursor: "next",
        total_count: 42,
      },
    });
  });

  it("supports sorting the local catalog by stars", async () => {
    const service = fakeService();
    const app = await createApp(service);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/clawhub/skills?sort=stars",
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(service.listCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER_ID }),
      { sort: "stars", limit: 24 },
    );
  });

  it("starts an actor-bound install preview without accepting package input", async () => {
    const service = fakeService();
    const app = await createApp(service);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/clawhub/skills/${SKILL_ID}/install-preview`,
    });

    expect(response.statusCode, response.body).toBe(202);
    expect(service.previewInstall).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER_ID }),
      SKILL_ID,
    );
    expect(response.json()).toMatchObject({
      success: true,
      data: { preview_token: "preview-token" },
    });
  });

  it("rejects malformed query and identifiers before calling the service", async () => {
    const service = fakeService();
    const app = await createApp(service);

    const invalidLimit = await app.inject({
      method: "GET",
      url: "/api/v1/clawhub/skills?limit=101",
    });
    const invalidId = await app.inject({
      method: "POST",
      url: "/api/v1/clawhub/skills/not-a-uuid/install-preview",
    });
    const invalidSort = await app.inject({
      method: "GET",
      url: "/api/v1/clawhub/skills?sort=updated",
    });
    const unexpectedPackage = await app.inject({
      method: "POST",
      url: `/api/v1/clawhub/skills/${SKILL_ID}/install-preview`,
      payload: { download_url: "https://attacker.example/skill.zip" },
    });

    expect(invalidLimit.statusCode).toBe(400);
    expect(invalidSort.statusCode).toBe(400);
    expect(invalidId.statusCode).toBe(400);
    expect(unexpectedPackage.statusCode).toBe(400);
    expect(service.listCatalog).not.toHaveBeenCalled();
    expect(service.previewInstall).not.toHaveBeenCalled();
  });
});

async function createApp(service: ReturnType<typeof fakeService>) {
  const app = Fastify();
  apps.push(app);
  app.setErrorHandler((error, request, reply) =>
    sendAppError(reply, request, error),
  );
  await app.register(clawHubRoutes, {
    prefix: "/api/v1/clawhub",
    service: service as never,
    resolveActor: () => ({ id: USER_ID, role: "user", status: "active" }),
  });
  await app.ready();
  return app;
}

function fakeService() {
  return {
    listCatalog: vi.fn(async () => ({
      items: [{ id: SKILL_ID }],
      nextCursor: "next",
      totalCount: 42,
    })),
    previewInstall: vi.fn(async () => ({ preview_token: "preview-token" })),
  };
}
