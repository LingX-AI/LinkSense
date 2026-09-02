import { describe, expect, it, vi } from "vitest"

import { SystemUpdateChecker } from "../src/modules/system/update-checker.js"

class MemoryUpdateCache {
  value: string | null = null

  async getSystemUpdateCache() {
    return this.value
  }

  async setSystemUpdateCache(value: string) {
    this.value = value
  }
}

const release = {
  tag_name: "v0.2.0",
  name: "LinkSense v0.2.0",
  body: "Administrator update notifications.",
  draft: false,
  prerelease: false,
  published_at: "2026-09-01T08:00:00.000Z",
  html_url: "https://github.com/LingX-AI/linksense/releases/tag/v0.2.0",
}

function githubResponse(
  body: unknown,
  init: ResponseInit = { status: 200 },
) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      etag: '"release-v0.2.0"',
      ...init.headers,
    },
  })
}

describe("SystemUpdateChecker", () => {
  it("reports a newer stable GitHub release", async () => {
    const fetch = vi.fn().mockResolvedValue(githubResponse(release))
    const checker = new SystemUpdateChecker("v0.1.1", new MemoryUpdateCache(), {
      fetch,
      now: () => new Date("2026-09-01T09:00:00.000Z"),
    })

    await expect(checker.getStatus()).resolves.toEqual({
      status: "update_available",
      current_version: "v0.1.1",
      latest_release: {
        version: "v0.2.0",
        name: "LinkSense v0.2.0",
        published_at: "2026-09-01T08:00:00.000Z",
        url: "https://github.com/LingX-AI/linksense/releases/tag/v0.2.0",
        release_notes: "Administrator update notifications.",
      },
      checked_at: "2026-09-01T09:00:00.000Z",
      error_code: null,
    })
    expect(fetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/LingX-AI/linksense/releases/latest",
      expect.objectContaining({ method: "GET", redirect: "error" }),
    )
  })

  it("reports up to date when the latest release is not newer", async () => {
    const fetch = vi.fn().mockResolvedValue(
      githubResponse({
        ...release,
        tag_name: "v0.1.1",
        name: "LinkSense v0.1.1",
        html_url:
          "https://github.com/LingX-AI/linksense/releases/tag/v0.1.1",
      }),
    )
    const checker = new SystemUpdateChecker("v0.1.1", new MemoryUpdateCache(), {
      fetch,
      now: () => new Date("2026-09-01T09:00:00.000Z"),
    })

    await expect(checker.getStatus()).resolves.toMatchObject({
      status: "up_to_date",
      current_version: "v0.1.1",
      latest_release: { version: "v0.1.1" },
      error_code: null,
    })
  })

  it("reuses the shared cache until the automatic check interval expires", async () => {
    const cache = new MemoryUpdateCache()
    const fetch = vi.fn().mockResolvedValue(githubResponse(release))
    const checker = new SystemUpdateChecker("v0.1.1", cache, {
      fetch,
      now: () => new Date("2026-09-01T09:00:00.000Z"),
    })

    await checker.getStatus()
    await checker.getStatus()

    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("uses the cached release when GitHub returns not modified", async () => {
    const cache = new MemoryUpdateCache()
    const initial = new SystemUpdateChecker("v0.1.1", cache, {
      fetch: vi.fn().mockResolvedValue(githubResponse(release)),
      now: () => new Date("2026-09-01T09:00:00.000Z"),
    })
    await initial.getStatus()
    const fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 304,
        headers: { etag: '"release-v0.2.0"' },
      }),
    )
    const checker = new SystemUpdateChecker("v0.1.1", cache, {
      fetch,
      now: () => new Date("2026-09-01T16:00:00.000Z"),
    })

    await expect(checker.getStatus()).resolves.toMatchObject({
      status: "update_available",
      checked_at: "2026-09-01T16:00:00.000Z",
    })
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "If-None-Match": '"release-v0.2.0"',
        }),
      }),
    )
  })

  it("forces a fresh check when an administrator requests one", async () => {
    const cache = new MemoryUpdateCache()
    const fetch = vi.fn().mockResolvedValue(githubResponse(release))
    const checker = new SystemUpdateChecker("v0.1.1", cache, { fetch })

    await checker.getStatus()
    await checker.getStatus(true)

    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it("returns a stable failure without exposing GitHub response content", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response("private diagnostic", {
        status: 403,
        headers: { "x-ratelimit-remaining": "0" },
      }),
    )
    const checker = new SystemUpdateChecker("v0.1.1", new MemoryUpdateCache(), {
      fetch,
      now: () => new Date("2026-09-01T09:00:00.000Z"),
    })

    await expect(checker.getStatus()).resolves.toEqual({
      status: "check_failed",
      current_version: "v0.1.1",
      latest_release: null,
      checked_at: "2026-09-01T09:00:00.000Z",
      error_code: "GITHUB_RATE_LIMITED",
    })
  })

  it("rejects unexpected release tags and external release URLs", async () => {
    const fetch = vi.fn().mockResolvedValue(
      githubResponse({
        ...release,
        tag_name: "latest",
        html_url: "https://example.test/releases/latest",
      }),
    )
    const checker = new SystemUpdateChecker("v0.1.1", new MemoryUpdateCache(), {
      fetch,
      now: () => new Date("2026-09-01T09:00:00.000Z"),
    })

    await expect(checker.getStatus()).resolves.toMatchObject({
      status: "check_failed",
      error_code: "GITHUB_RESPONSE_INVALID",
    })
  })
})
