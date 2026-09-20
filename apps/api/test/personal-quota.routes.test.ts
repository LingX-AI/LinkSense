import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { personalUsageRoutes } from "../src/modules/usage/routes.js";
import { sendAppError } from "../src/lib/http.js";
import { AppError } from "../src/lib/errors.js";
import type { AppServices } from "../src/services.js";

const USER = "10000000-0000-4000-8000-000000000001";
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
async function fixture(authenticated = true) {
  const app = Fastify(); apps.push(app);
  app.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
  app.decorate("authenticate", async request => {
    if (!authenticated) throw new AppError("AUTH_REQUIRED");
    request.authUser = { id: USER, email: "user@example.test", name: "User", role: "user", status: "active", preferredLocale: "zh-CN", avatarObjectKey: null, authValidAfter: new Date("2026-01-01") };
  });
  const overview = { limit: null, remaining: null, used: "1.000001", reset_at: "2026-09-20T16:00:00Z", time_zone: "Asia/Shanghai" };
  const analytics = { generated_at: "2026-09-20T02:00:00Z", range: "7d", time_zone: "UTC", dates: [], credits: [], tasks: [], tools: [], skills: [], messages: [] };
  const personalOverview = vi.fn(async () => overview);
  const personalQuota = vi.fn(async () => analytics);
  await app.register(personalUsageRoutes, { prefix: "/me/usage", services: {
    creditLimits: { personalOverview }, usageAnalytics: { personalQuota },
  } as unknown as AppServices });
  return { app, personalOverview, personalQuota };
}
describe("personal quota endpoint", () => {
  it("allows a normal member and scopes both queries to the authenticated user", async () => {
    const f = await fixture();
    const response = await f.app.inject("/me/usage/quota?range=30d&time_zone=Asia%2FShanghai");
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(f.personalOverview).toHaveBeenCalledWith(USER);
    expect(f.personalQuota).toHaveBeenCalledWith(USER, { range: "30d", time_zone: "Asia/Shanghai" });
    expect(response.json().data.overview.used).toBe("1.000001");
  });
  it.each(["user_id=someone-else", "range=all", "time_zone=invalid"])("rejects invalid query %s", async query => {
    const f = await fixture(); const response = await f.app.inject(`/me/usage/quota?${query}`);
    expect(response.statusCode).toBe(400);
    expect(f.personalQuota).not.toHaveBeenCalled();
    expect(f.personalOverview).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated requests before reading data", async () => {
    const f = await fixture(false); const response = await f.app.inject("/me/usage/quota");
    expect(response.statusCode).toBe(401);
    expect(f.personalQuota).not.toHaveBeenCalled();
  });
});
