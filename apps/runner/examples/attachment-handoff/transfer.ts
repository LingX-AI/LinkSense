import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const endpointSchema = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
});
export const handoffConfigurationSchema = z.strictObject({
  attachmentRoot: z.string().min(1).refine(path.isAbsolute),
  conversationId: z.uuid(),
  authorizationUrl: endpointSchema,
  uploadUrl: endpointSchema,
  bearerToken: z.string().min(1),
});
const authorizationSchema = z.strictObject({
  id: z.uuid(),
  conversation_id: z.uuid(),
  status: z.enum(["confirmed", "cancelled"]),
  expires_at: z.iso.datetime(),
  files: z.array(z.strictObject({
    relative_path: z.string().min(1).max(4096),
    filename: z.string().min(1).max(255).refine((name) =>
      !/[\\/]/u.test(name) && [...name].every((character) => character.charCodeAt(0) >= 32)),
    media_type: z.enum(["image/png", "image/jpeg", "application/pdf"]),
    size: z.number().int().min(1).max(MAX_FILE_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })).min(1).max(8),
});
const receiptSchema = z.strictObject({
  record_id: z.string().min(1).max(200),
  accepted_sha256: z.array(z.string().regex(/^[a-f0-9]{64}$/u)).max(8),
});

export type HandoffConfiguration = z.infer<typeof handoffConfigurationSchema>;

/** Called by a business-owned STDIO MCP adapter, not by LinkSense HTTP routes. */
export async function transferAttachments(
  configuration: HandoffConfiguration,
  handoffId: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<{ status: "cancelled" } | { status: "completed"; record_id: string; accepted_sha256: string[] }> {
  const config = handoffConfigurationSchema.parse(configuration);
  const id = z.uuid().parse(handoffId);
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  requestSignal.throwIfAborted();
  const headers = { authorization: `Bearer ${config.bearerToken}` };
  const authorizationResponse = await fetcher(config.authorizationUrl, {
    method: "POST", headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ handoff_id: id, conversation_id: config.conversationId }),
    signal: requestSignal, redirect: "error",
  });
  if (!authorizationResponse.ok) throw new Error("HANDOFF_NOT_AUTHORIZED");
  const grant = authorizationSchema.parse(await authorizationResponse.json());
  if (grant.id !== id || grant.conversation_id !== config.conversationId) throw new Error("HANDOFF_NOT_AUTHORIZED");
  if (grant.status === "cancelled") return { status: "cancelled" };
  if (Date.parse(grant.expires_at) <= Date.now()) throw new Error("HANDOFF_EXPIRED");
  if (grant.files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) throw new Error("HANDOFF_TOO_LARGE");
  if (new Set(grant.files.map((file) => file.relative_path)).size !== grant.files.length) throw new Error("HANDOFF_INVALID_FILES");
  const root = await realpath(config.attachmentRoot);
  const form = new FormData();
  form.set("handoff_id", id);
  for (const file of grant.files) {
    if (path.isAbsolute(file.relative_path) || file.relative_path.split(/[\\/]/u).some((part) => part === "..")) throw new Error("HANDOFF_INVALID_FILE");
    const target = await realpath(path.resolve(root, file.relative_path));
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error("HANDOFF_INVALID_FILE");
    const expected = await lstat(target);
    if (!expected.isFile() || expected.size !== file.size) throw new Error("HANDOFF_FILE_CHANGED");
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size !== file.size || before.dev !== expected.dev || before.ino !== expected.ino) throw new Error("HANDOFF_FILE_CHANGED");
      // shortcut: bounded demo buffers at most 16 MiB; use streaming for larger business uploads.
      const bytes = Buffer.alloc(file.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) throw new Error("HANDOFF_FILE_CHANGED");
        offset += bytesRead;
      }
      const extra = await handle.read(Buffer.alloc(1), 0, 1, offset);
      const after = await handle.stat();
      if (extra.bytesRead || before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
          createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error("HANDOFF_FILE_CHANGED");
      form.append("files", new Blob([new Uint8Array(bytes)], { type: file.media_type }), file.filename);
    } finally {
      await handle.close();
    }
  }
  requestSignal.throwIfAborted();
  if (Date.parse(grant.expires_at) <= Date.now()) throw new Error("HANDOFF_EXPIRED");
  const response = await fetcher(config.uploadUrl, {
    method: "POST", headers: { ...headers, "idempotency-key": id },
    body: form, signal: requestSignal, redirect: "error",
  });
  if (!response.ok) throw new Error("HANDOFF_UPLOAD_FAILED");
  const receipt = receiptSchema.parse(await response.json());
  if (receipt.accepted_sha256.length !== grant.files.length ||
      [...receipt.accepted_sha256].sort().join(",") !== grant.files.map((file) => file.sha256).sort().join(",")) throw new Error("HANDOFF_PARTIAL_UPLOAD");
  return { status: "completed", ...receipt };
}
