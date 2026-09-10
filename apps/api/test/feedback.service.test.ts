import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { AppError } from "../src/lib/errors.js";
import { FeedbackService } from "../src/modules/feedback/service.js";
import type {
  FeedbackActor,
  FeedbackAudit,
  FeedbackCleanup,
  FeedbackStorage,
  FeedbackStore,
} from "../src/modules/feedback/types.js";

const NOW = new Date("2026-08-03T05:06:07.000Z");
const ACTOR: FeedbackActor = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "林晓",
  email: "lin@example.com",
  role: "user",
  status: "active",
};
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("FeedbackService", () => {
  it("validates, stores, persists, and audits a multi-image feedback submission", async () => {
    const fixture = feedbackFixture();

    await expect(
      fixture.service.submit(
        ACTOR,
        {
          content: "  图片预览有时打不开。  ",
          images: [
            {
              filename: "截图 1.png",
              declaredMimeType: "image/png",
              bytes: PNG,
            },
            {
              filename: "../截图 2.png",
              declaredMimeType: "image/png",
              bytes: PNG,
            },
          ],
        },
        { ipAddress: "127.0.0.1", userAgent: "vitest" },
      ),
    ).resolves.toEqual({
      id: "10000000-0000-4000-8000-000000000010",
      created_at: NOW.toISOString(),
      image_count: 2,
    });

    expect(fixture.storage.putObject).toHaveBeenCalledTimes(2);
    expect(fixture.storage.putObject).toHaveBeenNthCalledWith(
      1,
      "feedbacks/10000000-0000-4000-8000-000000000010/images/10000000-0000-4000-8000-000000000011.png",
      PNG,
      expect.objectContaining({
        "content-type": "image/png",
        "original-filename": "截图 1.png",
        "checksum-sha256": expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
    );
    expect(fixture.store.create).toHaveBeenCalledWith(
      expect.objectContaining({
        submitterId: ACTOR.id,
        submitterName: ACTOR.name,
        submitterEmail: ACTOR.email,
        content: "图片预览有时打不开。",
        images: [
          expect.objectContaining({ sortOrder: 0, filename: "截图 1.png" }),
          expect.objectContaining({ sortOrder: 1, filename: ".._截图 2.png" }),
        ],
      }),
    );
    expect(fixture.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "feedback_submitted",
        metadata: { image_count: 2, content_length: 10 },
      }),
    );
  });

  it("rejects spoofed images before writing MinIO or the database", async () => {
    const fixture = feedbackFixture();

    await expect(
      fixture.service.submit(ACTOR, {
        content: "伪造文件",
        images: [
          {
            filename: "fake.png",
            declaredMimeType: "image/png",
            bytes: Buffer.from("not an image"),
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "FEEDBACK_SUBMISSION_INVALID" });
    expect(fixture.storage.putObject).not.toHaveBeenCalled();
    expect(fixture.store.create).not.toHaveBeenCalled();
  });

  it("removes already uploaded objects when a later upload fails", async () => {
    const fixture = feedbackFixture();
    vi.mocked(fixture.storage.putObject)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("minio unavailable"));

    await expect(
      fixture.service.submit(ACTOR, {
        content: "上传失败",
        images: [
          { filename: "one.png", declaredMimeType: "image/png", bytes: PNG },
          { filename: "two.png", declaredMimeType: "image/png", bytes: PNG },
        ],
      }),
    ).rejects.toMatchObject({ code: "FEEDBACK_SUBMISSION_FAILED" });
    expect(fixture.storage.removeObject).toHaveBeenCalledOnce();
    expect(fixture.store.create).not.toHaveBeenCalled();
  });

  it("cleans every object when database persistence fails and enqueues failed deletion", async () => {
    const fixture = feedbackFixture();
    vi.mocked(fixture.store.create).mockRejectedValueOnce(new Error("db down"));
    vi.mocked(fixture.storage.removeObject).mockRejectedValueOnce(
      new Error("delete down"),
    );

    await expect(
      fixture.service.submit(ACTOR, {
        content: "数据库失败",
        images: [
          { filename: "one.png", declaredMimeType: "image/png", bytes: PNG },
        ],
      }),
    ).rejects.toMatchObject({ code: "FEEDBACK_SUBMISSION_FAILED" });
    expect(fixture.cleanup.scheduleObjectRemoval).toHaveBeenCalledWith(
      expect.stringContaining("/images/"),
    );
  });

  it("enforces administrator reads and verifies stored image size", async () => {
    const fixture = feedbackFixture();
    const admin = { ...ACTOR, role: "admin" as const };
    vi.mocked(fixture.store.findImage).mockResolvedValueOnce({
      id: "10000000-0000-4000-8000-000000000011",
      feedbackId: "10000000-0000-4000-8000-000000000010",
      objectKey: "feedbacks/f/images/i.png",
      filename: "i.png",
      mimeType: "image/png",
      sizeBytes: PNG.byteLength,
      checksumSha256: "a".repeat(64),
      sortOrder: 0,
      createdAt: NOW,
    });
    vi.mocked(fixture.storage.getObjectSize).mockResolvedValueOnce(
      PNG.byteLength,
    );
    vi.mocked(fixture.storage.getObjectStream).mockResolvedValueOnce(
      Readable.from(PNG),
    );

    await expect(async () =>
      fixture.service.listForAdmin(ACTOR, {}),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      fixture.service.readImageForAdmin(
        admin,
        "10000000-0000-4000-8000-000000000010",
        "10000000-0000-4000-8000-000000000011",
      ),
    ).resolves.toMatchObject({
      filename: "i.png",
      mimeType: "image/png",
      sizeBytes: PNG.byteLength,
    });
  });

  it("deletes administrator-selected feedback and cleans every stored image", async () => {
    const fixture = feedbackFixture();
    const admin = { ...ACTOR, role: "admin" as const };
    vi.mocked(fixture.store.delete).mockResolvedValueOnce({
      id: "10000000-0000-4000-8000-000000000010",
      imageObjectKeys: [
        "feedbacks/f/images/one.png",
        "feedbacks/f/images/two.png",
      ],
    });
    vi.mocked(fixture.storage.removeObject)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("minio unavailable"));

    await expect(
      fixture.service.deleteForAdmin(
        admin,
        "10000000-0000-4000-8000-000000000010",
        { ipAddress: "127.0.0.1", userAgent: "vitest" },
      ),
    ).resolves.toBeUndefined();

    expect(fixture.storage.removeObject).toHaveBeenCalledTimes(2);
    expect(fixture.cleanup.scheduleObjectRemoval).toHaveBeenCalledWith(
      "feedbacks/f/images/two.png",
    );
    expect(fixture.audit.write).toHaveBeenCalledWith({
      actorId: admin.id,
      action: "feedback_deleted",
      targetType: "feedback",
      targetId: "10000000-0000-4000-8000-000000000010",
      result: "success",
      metadata: { image_count: 2 },
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    });
  });

  it("rejects non-administrator deletion and reports missing feedback", async () => {
    const fixture = feedbackFixture();

    await expect(
      fixture.service.deleteForAdmin(
        ACTOR,
        "10000000-0000-4000-8000-000000000010",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.store.delete).not.toHaveBeenCalled();

    await expect(
      fixture.service.deleteForAdmin(
        { ...ACTOR, role: "admin" },
        "10000000-0000-4000-8000-000000000010",
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fixture.storage.removeObject).not.toHaveBeenCalled();
  });
  it.each([
    { content: "  已处理  ", images: [] },
    {
      content: "",
      images: [
        { filename: "reply.png", declaredMimeType: "image/png", bytes: PNG },
      ],
    },
    {
      content: "请参考截图",
      images: [
        { filename: "reply.png", declaredMimeType: "image/png", bytes: PNG },
      ],
    },
  ])(
    "persists an administrator reply with text and/or images: %j",
    async (input) => {
      const fixture = feedbackFixture();
      await expect(
        fixture.service.replyForAdmin(
          { ...ACTOR, role: "admin" },
          "parent",
          input,
        ),
      ).resolves.toMatchObject({ image_count: input.images.length });
      expect(fixture.store.createReply).toHaveBeenCalledWith(
        expect.objectContaining({
          feedbackId: "parent",
          authorId: ACTOR.id,
          content: input.content.trim(),
        }),
      );
      expect(fixture.store.create).not.toHaveBeenCalled();
      expect(fixture.audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "feedback_replied",
          targetId: "parent",
        }),
      );
    },
  );

  it("rejects empty replies and spoofed attachments without writing anything", async () => {
    const fixture = feedbackFixture();
    for (const input of [
      { content: "  ", images: [] },
      { content: "a".repeat(2001), images: [] },
      {
        content: "test",
        images: [
          {
            filename: "fake.png",
            declaredMimeType: "image/png",
            bytes: Buffer.from("fake"),
          },
        ],
      },
      {
        content: "test",
        images: Array.from({ length: 10 }, () => ({
          filename: "a.png",
          declaredMimeType: "image/png",
          bytes: PNG,
        })),
      },
    ]) {
      await expect(
        fixture.service.replyForAdmin(
          { ...ACTOR, role: "admin" },
          "parent",
          input,
        ),
      ).rejects.toMatchObject({ code: "FEEDBACK_SUBMISSION_INVALID" });
    }
    expect(fixture.storage.putObject).not.toHaveBeenCalled();
    expect(fixture.store.createReply).not.toHaveBeenCalled();
  });

  it("rejects user replies and missing parents before uploading", async () => {
    const fixture = feedbackFixture();
    await expect(
      fixture.service.replyForAdmin(ACTOR, "parent", {
        content: "hello",
        images: [],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    vi.mocked(fixture.store.exists).mockResolvedValue(false);
    await expect(
      fixture.service.replyForAdmin({ ...ACTOR, role: "admin" }, "parent", {
        content: "hello",
        images: [],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fixture.storage.putObject).not.toHaveBeenCalled();
    expect(fixture.store.createReply).not.toHaveBeenCalled();
  });

  it("cleans reply images if the parent is deleted while the upload is in progress", async () => {
    const fixture = feedbackFixture();
    vi.mocked(fixture.store.createReply).mockRejectedValue(
      new AppError("NOT_FOUND"),
    );
    await expect(
      fixture.service.replyForAdmin({ ...ACTOR, role: "admin" }, "parent", {
        content: "",
        images: [
          { filename: "a.png", declaredMimeType: "image/png", bytes: PNG },
        ],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fixture.storage.removeObject).toHaveBeenCalledOnce();
    expect(fixture.audit.write).not.toHaveBeenCalled();
  });

  it("restricts personal lists to the actor and removes submitter identity from the response", async () => {
    const fixture = feedbackFixture();
    vi.mocked(fixture.store.list).mockResolvedValue({
      items: [
        {
          id: ACTOR.id,
          content: "内容",
          created_at: NOW.toISOString(),
          images: [],
          reply_count: 2,
          submitter: { id: ACTOR.id, name: ACTOR.name, email: ACTOR.email },
        },
      ],
      next_cursor: null,
    });
    const result = await fixture.service.listForUser(ACTOR, { limit: 10 });
    expect(fixture.store.list).toHaveBeenCalledWith({
      limit: 10,
      submitterId: ACTOR.id,
    });
    expect(result.items[0]).toMatchObject({ reply_count: 2 });
    expect(result.items[0]).not.toHaveProperty("submitter");
    await expect(
      fixture.service.listForUser(ACTOR, { submitterId: "other" }),
    ).rejects.toThrow();
  });

  it("enforces ownership for details and both original and reply image reads", async () => {
    const fixture = feedbackFixture();
    vi.mocked(fixture.store.exists).mockResolvedValue(false);
    await expect(fixture.service.details(ACTOR, "other")).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    expect(fixture.store.findDetails).toHaveBeenCalledWith({
      feedbackId: "other",
      submitterId: ACTOR.id,
    });
    for (const replyId of [undefined, "reply"]) {
      await expect(
        fixture.service.readImageForUser(ACTOR, "other", "image", replyId),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(fixture.store.findImage).not.toHaveBeenCalled();
    expect(fixture.storage.getObjectStream).not.toHaveBeenCalled();
    await expect(
      fixture.service.details(ACTOR, "other", true),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows owners to read reply images but rejects missing objects", async () => {
    const fixture = feedbackFixture();
    vi.mocked(fixture.store.findImage).mockResolvedValue({
      id: ACTOR.id,
      feedbackId: "parent",
      objectKey: "reply/image",
      filename: "reply.png",
      mimeType: "image/png",
      sizeBytes: PNG.length,
      checksumSha256: "a".repeat(64),
      sortOrder: 0,
      createdAt: NOW,
    });
    vi.mocked(fixture.storage.getObjectSize).mockResolvedValueOnce(PNG.length);
    await expect(
      fixture.service.readImageForUser(ACTOR, "parent", "image", "reply"),
    ).resolves.toMatchObject({ filename: "reply.png" });
    expect(fixture.store.findImage).toHaveBeenCalledWith({
      feedbackId: "parent",
      imageId: "image",
      replyId: "reply",
    });
    await expect(
      fixture.service.readImageForUser(ACTOR, "parent", "image", "reply"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

function feedbackFixture() {
  const ids = [
    "10000000-0000-4000-8000-000000000010",
    "10000000-0000-4000-8000-000000000011",
    "10000000-0000-4000-8000-000000000012",
  ];
  const store: FeedbackStore = {
    createReply: vi.fn(async (input) => ({
      id: input.id,
      created_at: input.createdAt.toISOString(),
      image_count: input.images.length,
    })),
    exists: vi.fn(async () => true),
    findDetails: vi.fn(async () => null),
    create: vi.fn(async (input) => ({
      id: input.id,
      created_at: input.createdAt.toISOString(),
      image_count: input.images.length,
    })),
    list: vi.fn(async () => ({ items: [], next_cursor: null })),
    findImage: vi.fn(async () => null),
    delete: vi.fn(async () => null),
  };
  const storage: FeedbackStorage = {
    putObject: vi.fn(async () => undefined),
    getObjectSize: vi.fn(async () => 0),
    getObjectStream: vi.fn(async () => Readable.from([])),
    removeObject: vi.fn(async () => undefined),
  };
  const cleanup: FeedbackCleanup = {
    scheduleObjectRemoval: vi.fn(async () => undefined),
  };
  const audit: FeedbackAudit = {
    write: vi.fn(async () => undefined),
  };
  return {
    store,
    storage,
    cleanup,
    audit,
    service: new FeedbackService({
      store,
      storage,
      cleanup,
      audit,
      now: () => NOW,
      createId: () => ids.shift() ?? "10000000-0000-4000-8000-999999999999",
    }),
  };
}
