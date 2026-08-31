import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  ClawHubClient,
} from "../src/modules/clawhub/client.js";
import {
  CLAWHUB_FILE_BYTE_LIMIT,
  type ClawHubVersionFile,
} from "../src/modules/clawhub/types.js";

describe("ClawHubClient catalog reads", () => {
  it("uses the fixed legacy list endpoint and marks ownerless items unresolved", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(skillListFixture()));
    const client = new ClawHubClient({ fetcher });

    const page = await client.listSkills();

    expect(fetcher).toHaveBeenCalledTimes(1);
    const url = requestedUrl(fetcher);
    expect(url.origin).toBe("https://clawhub.ai");
    expect(url.pathname).toBe("/api/v1/skills");
    expect(url.searchParams.get("limit")).toBe("200");
    expect(url.searchParams.get("sort")).toBe("name");
    expect(page.nextCursor).toBe("next-page");
    expect(page.items[0]).toMatchObject({
      upstreamSkillId: null,
      identityResolved: false,
      ownerHandle: null,
      slug: "example-skill",
      description: null,
      stats: {
        comments: 0,
        downloads: 12,
        installs: 3,
        stars: 2,
        versions: 1,
      },
    });
  });

  it("uses publisher-qualified package items as the complete sync identity source", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(skillPackageListFixture()));
    const client = new ClawHubClient({ fetcher });

    const page = await client.listSkillPackages({
      cursor: "opaque cursor",
      limit: 80,
    });

    const url = requestedUrl(fetcher);
    expect(url.pathname).toBe("/api/v1/packages");
    expect(url.searchParams.get("family")).toBe("skill");
    expect(url.searchParams.get("limit")).toBe("80");
    expect(url.searchParams.get("sort")).toBe("updated");
    expect(url.searchParams.get("cursor")).toBe("opaque cursor");
    expect(page).toEqual({
      items: [
        {
          upstreamSkillId: "skill_123",
          ownerHandle: "publisher",
          slug: "example-skill",
          displayName: "Example Skill",
          summary: "Does useful work.",
          latestVersion: "1.2.3",
          categories: ["productivity"],
          topics: ["testing"],
          channel: "community",
          isOfficial: false,
          verificationTier: "source-linked",
          stats: {
            comments: 0,
            downloads: 12,
            installs: 3,
            stars: 2,
            versions: 1,
          },
          createdAt: 1_730_000_000_000,
          updatedAt: 1_730_000_100_000,
          canonicalUrl:
            "https://clawhub.ai/publisher/skills/example-skill",
        },
      ],
      nextCursor: null,
    });
  });

  it("validates core fields while allowing additive upstream fields", async () => {
    const fixture = skillPackageListFixture();
    fixture.items[0]!.futureTopLevelField = { enabled: true };
    const client = new ClawHubClient({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture)),
    });

    await expect(client.listSkillPackages()).resolves.toMatchObject({
      items: [{ ownerHandle: "publisher", slug: "example-skill" }],
    });

    const malformed = skillPackageListFixture();
    Reflect.deleteProperty(malformed.items[0]!, "ownerHandle");
    const malformedClient = new ClawHubClient({
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json(malformed)),
      maxAttempts: 1,
    });
    await expect(malformedClient.listSkillPackages()).rejects.toMatchObject({
      kind: "INVALID_RESPONSE",
    });
  });
});

describe("ClawHubClient qualified skill reads", () => {
  it("always sends a normalized ownerHandle for detail, version, and file reads", async () => {
    const fileBytes = Buffer.from("skill body");
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("ownerHandle")).toBe("publisher");
      if (url.pathname.endsWith("/versions/1.2.3")) {
        return Response.json(versionDetailFixture());
      }
      if (url.pathname.endsWith("/file")) {
        expect(url.searchParams.get("version")).toBe("1.2.3");
        expect(url.searchParams.get("path")).toBe("SKILL.md");
        return new Response(fileBytes, {
          headers: {
            "content-type": "text/markdown",
            "x-content-size": String(fileBytes.byteLength),
            "x-content-sha256": sha256(fileBytes),
          },
        });
      }
      return Response.json(skillDetailFixture("publisher"));
    });
    const client = new ClawHubClient({ fetcher });

    const detail = await client.getSkillDetail({
      ownerHandle: "@@Publisher",
      slug: "example-skill",
    });
    const version = await client.getVersionDetail({
      ownerHandle: "@Publisher",
      slug: "example-skill",
      version: "1.2.3",
    });
    const file = await client.getVersionFile({
      ownerHandle: "Publisher",
      slug: "example-skill",
      version: "1.2.3",
      path: "SKILL.md",
    });

    expect(detail).toMatchObject({
      upstreamSkillId: "skill_123",
      requestedSlug: "example-skill",
      owner: { handle: "publisher", displayName: "Publisher" },
      description: "Full description",
      icon: "lucide:box",
      metadata: { os: ["linux"], systems: ["x86_64-linux"] },
      moderation: { isSuspicious: false, isMalwareBlocked: false },
    });
    expect(version).toMatchObject({
      ownerHandle: "publisher",
      upstreamSkillId: "skill_123",
      version: {
        upstreamVersionId: "version_123",
        version: "1.2.3",
        security: { status: "clean", hasScanResult: true },
      },
    });
    expect(file).toEqual({
      bytes: fileBytes,
      contentType: "text/markdown",
      contentSha256: sha256(fileBytes),
      contentSize: fileBytes.byteLength,
    });
  });

  it("expands a 409 ambiguous slug into all publisher-qualified details", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      const ownerHandle = url.searchParams.get("ownerHandle");
      if (ownerHandle === null) {
        return Response.json(
          {
            code: "AMBIGUOUS_SKILL_SLUG",
            message: "Choose a publisher",
            slug: "shared-skill",
            matches: [
              {
                ownerHandle: "first-owner",
                slug: "shared-skill",
                ref: "@first-owner/shared-skill",
                url: "https://clawhub.ai/first-owner/skills/shared-skill",
              },
              {
                ownerHandle: "second-owner",
                slug: "shared-skill",
                ref: "@second-owner/shared-skill",
                url: "https://clawhub.ai/second-owner/skills/shared-skill",
              },
            ],
          },
          { status: 409 },
        );
      }
      return Response.json(skillDetailFixture(ownerHandle, "shared-skill"));
    });
    const client = new ClawHubClient({ fetcher });

    const details = await client.getSkillDetailsForSlug("shared-skill");

    expect(details.map((detail) => detail.owner.handle)).toEqual([
      "first-owner",
      "second-owner",
    ]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(
      fetcher.mock.calls
        .slice(1)
        .map(([input]) => new URL(String(input)).searchParams.get("ownerHandle")),
    ).toEqual(["first-owner", "second-owner"]);
  });

  it("rejects a qualified detail that resolves to a different publisher", async () => {
    const client = new ClawHubClient({
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json(skillDetailFixture("other-owner"))),
      maxAttempts: 1,
    });

    await expect(
      client.getSkillDetail({
        ownerHandle: "expected-owner",
        slug: "example-skill",
      }),
    ).rejects.toMatchObject({ kind: "INVALID_RESPONSE" });
  });
});

describe("ClawHubClient retries and response bounds", () => {
  it("honors Retry-After and adds deterministic jitter before retrying 429", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("Rate limit exceeded", {
          status: 429,
          headers: { "retry-after": "2" },
        }),
      )
      .mockResolvedValueOnce(Response.json(skillListFixture()));
    const sleep = vi.fn(async () => undefined);
    const client = new ClawHubClient({
      fetcher,
      sleep,
      random: () => 0.5,
    });

    await expect(client.listSkills()).resolves.toBeDefined();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_100);
  });

  it("falls back to RateLimit-Reset when Retry-After is absent", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("Rate limit exceeded", {
          status: 429,
          headers: { "ratelimit-reset": "3" },
        }),
      )
      .mockResolvedValueOnce(Response.json(skillListFixture()));
    const sleep = vi.fn(async () => undefined);
    const client = new ClawHubClient({
      fetcher,
      sleep,
      random: () => 0,
    });

    await client.listSkills();

    expect(sleep).toHaveBeenCalledWith(3_000);
  });

  it("bounds retries and preserves a plain-text upstream error", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () =>
          new Response("Temporary upstream failure", { status: 503 }),
      );
    const sleep = vi.fn(async () => undefined);
    const client = new ClawHubClient({
      fetcher,
      sleep,
      maxAttempts: 2,
      random: () => 0,
    });

    await expect(client.listSkills()).rejects.toMatchObject({
      kind: "HTTP_ERROR",
      status: 503,
      responseBody: "Temporary upstream failure",
      retryable: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("times out a request and does not exceed its attempt budget", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const client = new ClawHubClient({
      fetcher,
      requestTimeoutMs: 1,
      maxAttempts: 1,
    });

    await expect(client.listSkills()).rejects.toMatchObject({
      kind: "REQUEST_TIMEOUT",
      retryable: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects declared JSON and file responses above their byte limits", async () => {
    const jsonClient = new ClawHubClient({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response("{}", {
          headers: { "content-length": String(16 * 1024 * 1024 + 1) },
        }),
      ),
      maxAttempts: 1,
    });
    await expect(jsonClient.listSkills()).rejects.toMatchObject({
      kind: "RESPONSE_TOO_LARGE",
    });

    const fileClient = new ClawHubClient({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response("x", {
          headers: { "content-length": String(CLAWHUB_FILE_BYTE_LIMIT + 1) },
        }),
      ),
      maxAttempts: 1,
    });
    await expect(
      fileClient.getVersionFile({
        ownerHandle: "publisher",
        slug: "example-skill",
        version: "1.2.3",
        path: "SKILL.md",
      }),
    ).rejects.toMatchObject({ kind: "RESPONSE_TOO_LARGE" });
  });
});

describe("ClawHubClient exact-version file downloads", () => {
  it("downloads at concurrency four and verifies every declared size and checksum", async () => {
    const contents = new Map(
      Array.from({ length: 5 }, (_, index) => {
        const path = `files/${index}.txt`;
        return [path, Buffer.from(`content-${index}`)] as const;
      }),
    );
    const manifest = Array.from(contents, ([path, bytes]) =>
      versionFile(path, bytes),
    );
    let active = 0;
    let maximumActive = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const path = new URL(String(input)).searchParams.get("path");
      const bytes = path === null ? undefined : contents.get(path);
      if (bytes === undefined) return new Response("missing", { status: 404 });
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return new Response(bytes, {
        headers: { "content-type": "text/plain" },
      });
    });
    const client = new ClawHubClient({ fetcher });

    const downloaded = await client.downloadVersionFiles({
      ownerHandle: "publisher",
      slug: "example-skill",
      version: "1.2.3",
      files: manifest,
    });

    expect(maximumActive).toBe(4);
    expect(downloaded.files.map((file) => file.path)).toEqual([
      ...contents.keys(),
    ]);
    expect(downloaded.files[0]?.bytes).toEqual(contents.get("files/0.txt"));
    expect(fetcher).toHaveBeenCalledTimes(5);
    for (const [input] of fetcher.mock.calls) {
      const url = new URL(String(input));
      expect(url.searchParams.get("ownerHandle")).toBe("publisher");
      expect(url.searchParams.get("version")).toBe("1.2.3");
    }
  });

  it("aborts active downloads and waits for every worker before rejecting", async () => {
    const contents = new Map(
      Array.from({ length: 8 }, (_, index) => {
        const path = `files/${index}.txt`;
        return [path, Buffer.from(`content-${index}`)] as const;
      }),
    );
    const started: string[] = [];
    const aborted: string[] = [];
    let releaseFailure!: () => void;
    const failureGate = new Promise<void>((resolve) => {
      releaseFailure = resolve;
    });
    let releaseAbortedRequests!: () => void;
    const abortedRequestGate = new Promise<void>((resolve) => {
      releaseAbortedRequests = resolve;
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input, init) => {
        const path = new URL(String(input)).searchParams.get("path");
        if (path === null) return new Response("missing path", { status: 400 });
        started.push(path);
        if (path === "files/0.txt") {
          await failureGate;
          return new Response("upstream missing", { status: 404 });
        }

        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal === undefined || signal === null) {
            reject(new Error("Expected a download abort signal"));
            return;
          }
          const abort = (): void => {
            aborted.push(path);
            void abortedRequestGate.then(() => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          };
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        });
      });
    const client = new ClawHubClient({ fetcher, maxAttempts: 1 });
    let operationSettled = false;
    const outcome = client
      .downloadVersionFiles({
        ownerHandle: "publisher",
        slug: "example-skill",
        version: "1.2.3",
        files: Array.from(contents, ([path, bytes]) => versionFile(path, bytes)),
      })
      .then(
        (value) => ({ status: "fulfilled" as const, value }),
        (error: unknown) => ({ status: "rejected" as const, error }),
      );
    void outcome.then(() => {
      operationSettled = true;
    });

    await vi.waitFor(() => expect(started).toHaveLength(4));
    releaseFailure();
    await vi.waitFor(() => expect(aborted).toHaveLength(3));
    await Promise.resolve();

    expect(operationSettled).toBe(false);
    expect(started).toEqual([
      "files/0.txt",
      "files/1.txt",
      "files/2.txt",
      "files/3.txt",
    ]);

    releaseAbortedRequests();
    const result = await outcome;

    expect(result).toMatchObject({
      status: "rejected",
      error: {
        kind: "HTTP_ERROR",
        status: 404,
        responseBody: "upstream missing",
      },
    });
    expect(operationSettled).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("propagates caller cancellation to every active download", async () => {
    const started: string[] = [];
    const aborted: string[] = [];
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(
        (input, init) =>
          new Promise<Response>((_resolve, reject) => {
            const path = new URL(String(input)).searchParams.get("path");
            if (path === null) {
              reject(new Error("Expected a file path"));
              return;
            }
            started.push(path);
            const signal = init?.signal;
            if (signal === undefined || signal === null) {
              reject(new Error("Expected a download abort signal"));
              return;
            }
            const abort = (): void => {
              aborted.push(path);
              reject(new DOMException("Aborted", "AbortError"));
            };
            if (signal.aborted) abort();
            else signal.addEventListener("abort", abort, { once: true });
          }),
      );
    const client = new ClawHubClient({ fetcher, maxAttempts: 1 });
    const caller = new AbortController();
    const operation = client.downloadVersionFiles({
      ownerHandle: "publisher",
      slug: "example-skill",
      version: "1.2.3",
      files: Array.from({ length: 6 }, (_, index) =>
        versionFile(`files/${index}.txt`, Buffer.from(`content-${index}`)),
      ),
      signal: caller.signal,
    });

    await vi.waitFor(() => expect(started).toHaveLength(4));
    caller.abort();

    await expect(operation).rejects.toMatchObject({ kind: "REQUEST_ABORTED" });
    expect(aborted).toHaveLength(4);
    expect(started).toEqual([
      "files/0.txt",
      "files/1.txt",
      "files/2.txt",
      "files/3.txt",
    ]);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("rejects unsafe, duplicate, oversized, and over-count manifests before fetching", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new ClawHubClient({ fetcher });
    const zeroSha = "0".repeat(64);
    const unsafe = [
      { path: "../secret", size: 1, sha256: zeroSha, contentType: "text/plain" },
    ];
    const duplicate = [
      { path: "A.txt", size: 1, sha256: zeroSha, contentType: "text/plain" },
      { path: "a.txt", size: 1, sha256: zeroSha, contentType: "text/plain" },
    ];
    const oversized = [
      {
        path: "large.bin",
        size: CLAWHUB_FILE_BYTE_LIMIT + 1,
        sha256: zeroSha,
        contentType: "application/octet-stream",
      },
    ];
    const tooMany = Array.from({ length: 1_001 }, (_, index) => ({
      path: `${index}.txt`,
      size: 0,
      sha256: zeroSha,
      contentType: "text/plain",
    }));

    for (const files of [unsafe, duplicate, oversized, tooMany]) {
      await expect(
        client.downloadVersionFiles({
          ownerHandle: "publisher",
          slug: "example-skill",
          version: "1.2.3",
          files,
        }),
      ).rejects.toMatchObject({ kind: "INVALID_MANIFEST" });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects manifests above 200 MiB before fetching", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new ClawHubClient({ fetcher });
    const files = Array.from({ length: 21 }, (_, index) => ({
      path: `${index}.bin`,
      size: CLAWHUB_FILE_BYTE_LIMIT,
      sha256: "0".repeat(64),
      contentType: "application/octet-stream",
    }));

    await expect(
      client.downloadVersionFiles({
        ownerHandle: "publisher",
        slug: "example-skill",
        version: "1.2.3",
        files,
      }),
    ).rejects.toMatchObject({ kind: "INVALID_MANIFEST" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects bytes that do not match the exact version manifest", async () => {
    const actual = Buffer.from("bad");
    const client = new ClawHubClient({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response(actual)),
    });

    await expect(
      client.downloadVersionFiles({
        ownerHandle: "publisher",
        slug: "example-skill",
        version: "1.2.3",
        files: [
          {
            path: "SKILL.md",
            size: actual.byteLength,
            sha256: "0".repeat(64),
            contentType: "text/markdown",
          },
        ],
      }),
    ).rejects.toMatchObject({ kind: "INTEGRITY_MISMATCH" });
  });

  it("keeps non-installable manifests readable as catalog metadata", async () => {
    const fixture = versionDetailFixture();
    fixture.version.files = [
      {
        path: "../SKILL.md",
        size: CLAWHUB_FILE_BYTE_LIMIT + 1,
        sha256: "0".repeat(64),
        contentType: "text/markdown",
      },
      ...Array.from({ length: 1_000 }, (_, index) => ({
        path: `metadata/${index}.txt`,
        size: 0,
        sha256: "0".repeat(64),
        contentType: "text/plain",
      })),
    ];
    const client = new ClawHubClient({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture)),
    });

    const detail = await client.getVersionDetail({
      ownerHandle: "publisher",
      slug: "example-skill",
      version: "1.2.3",
    });

    expect(detail.version.files).toHaveLength(1_001);
    expect(detail.version.files[0]).toMatchObject({
      path: "../SKILL.md",
      size: CLAWHUB_FILE_BYTE_LIMIT + 1,
    });
    await expect(
      client.downloadVersionFiles({
        ownerHandle: "publisher",
        slug: "example-skill",
        version: "1.2.3",
        files: detail.version.files,
      }),
    ).rejects.toMatchObject({ kind: "INVALID_MANIFEST" });
  });
});

function skillListFixture() {
  return {
    items: [
      {
        slug: "example-skill",
        displayName: "Example Skill",
        summary: "Does useful work.",
        topics: ["testing"],
        tags: { latest: "1.2.3" },
        stats: { downloads: 12, installs: 3, stars: 2, versions: 1 },
        createdAt: 1_730_000_000_000,
        updatedAt: 1_730_000_100_000,
        latestVersion: {
          version: "1.2.3",
          createdAt: 1_730_000_100_000,
          changelog: "Initial version",
          license: "MIT",
          additiveField: true,
        },
        metadata: null,
        additiveField: true,
      },
    ],
    nextCursor: "next-page",
    additiveField: true,
  };
}

function skillPackageListFixture() {
  return {
    items: [
      {
        id: "clawhub:skill_123",
        family: "skill" as const,
        name: "example-skill",
        ownerHandle: "Publisher",
        displayName: "Example Skill",
        summary: "Does useful work.",
        latestVersion: "1.2.3",
        categories: ["productivity"],
        topics: ["testing"],
        channel: "community",
        isOfficial: false,
        verificationTier: "source-linked" as const,
        stats: { downloads: 12, installs: 3, stars: 2, versions: 1 },
        createdAt: 1_730_000_000_000,
        updatedAt: 1_730_000_100_000,
        futureTopLevelField: undefined as unknown,
      },
    ],
    nextCursor: null,
  };
}

function skillDetailFixture(ownerHandle: string, slug = "example-skill") {
  return {
    skill: {
      _id: "skill_123",
      slug,
      displayName: "Example Skill",
      summary: "Does useful work.",
      description: "Full description",
      icon: "lucide:box",
      topics: ["testing"],
      tags: { latest: "1.2.3" },
      stats: {
        comments: 1,
        downloads: 12,
        installs: 3,
        stars: 2,
        versions: 1,
      },
      createdAt: 1_730_000_000_000,
      updatedAt: 1_730_000_100_000,
    },
    latestVersion: {
      version: "1.2.3",
      createdAt: 1_730_000_100_000,
      changelog: "Initial version",
      license: "MIT",
    },
    metadata: { os: ["linux"], systems: ["x86_64-linux"] },
    owner: {
      handle: ownerHandle,
      userId: "publisher_123",
      displayName: "Publisher",
      image: "https://example.test/avatar.png",
    },
    moderation: {
      isSuspicious: false,
      isMalwareBlocked: false,
      verdict: "clean",
      reasonCodes: [],
      summary: null,
      engineVersion: "v2",
      updatedAt: 1_730_000_100_000,
    },
  };
}

function versionDetailFixture() {
  const skillBytes = Buffer.from("skill body");
  return {
    skill: {
      _id: "skill_123",
      slug: "example-skill",
      displayName: "Example Skill",
    },
    version: {
      _id: "version_123",
      version: "1.2.3",
      createdAt: 1_730_000_100_000,
      changelog: "Initial version",
      changelogSource: "user",
      license: "MIT",
      files: [versionFile("SKILL.md", skillBytes)],
      security: {
        status: "clean",
        hasWarnings: false,
        hasScanResult: true,
        checkedAt: 1_730_000_200_000,
        scanners: { vt: { status: "clean" } },
      },
    },
  };
}

function versionFile(path: string, bytes: Buffer): ClawHubVersionFile {
  return {
    path,
    size: bytes.byteLength,
    sha256: sha256(bytes),
    contentType: "text/plain",
  };
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function requestedUrl(fetcher: ReturnType<typeof vi.fn<typeof fetch>>): URL {
  const request = fetcher.mock.calls[0]?.[0];
  if (request === undefined) throw new Error("Expected a request");
  return new URL(String(request));
}
