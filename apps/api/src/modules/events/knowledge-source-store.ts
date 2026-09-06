import { randomBytes } from "node:crypto";

import { z } from "zod";

import type { TurnKnowledgeSource } from "./knowledge-citations.js";

const SOURCE_MAP_KEY_PREFIX = "linksense:knowledge-source-map:";
const DEFAULT_SOURCE_MAP_TTL_SECONDS = 24 * 60 * 60;
const STORE_SOURCES_SCRIPT = `
for index = 2, #ARGV, 2 do
  redis.call('HSET', KEYS[1], ARGV[index], ARGV[index + 1])
end
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
return redis.call('HLEN', KEYS[1])
`;

const turnKnowledgeSourceSchema = z.strictObject({
  knowledgeBaseId: z.uuid(),
  documentId: z.uuid(),
  documentVersionId: z.uuid(),
  parentId: z.string().min(1).max(160),
  titlePath: z.array(z.string().min(1).max(500)).max(64),
  matchedChildIds: z.array(z.string().min(1).max(160)).max(1_000),
  pageNumbers: z.array(z.number().int().positive()).max(1_000),
});

type KnowledgeSourceRedisClient = {
  eval(
    script: string,
    numberOfKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string>>;
  del(key: string): Promise<number>;
};

export type RegisteredTurnKnowledgeSource = TurnKnowledgeSource & {
  sourceRef: string;
};

/**
 * Stores source handles only in Redis and scopes them to one projected turn.
 * PostgreSQL intentionally never receives source_ref or retrieval-result rows.
 */
export class TurnKnowledgeSourceStore {
  constructor(
    private readonly redis: KnowledgeSourceRedisClient,
    private readonly ttlSeconds = DEFAULT_SOURCE_MAP_TTL_SECONDS,
  ) {}

  async register(
    projectionTurnId: string,
    sources: readonly TurnKnowledgeSource[],
  ): Promise<RegisteredTurnKnowledgeSource[]> {
    if (sources.length === 0) return [];
    const registered = sources.map((source) => ({
      ...turnKnowledgeSourceSchema.parse(source),
      sourceRef: createSourceRef(),
    }));
    const argumentsList: Array<string | number> = [this.ttlSeconds];
    for (const source of registered) {
      argumentsList.push(
        source.sourceRef,
        JSON.stringify({
          knowledgeBaseId: source.knowledgeBaseId,
          documentId: source.documentId,
          documentVersionId: source.documentVersionId,
          parentId: source.parentId,
          titlePath: source.titlePath,
          matchedChildIds: source.matchedChildIds,
          pageNumbers: source.pageNumbers,
        }),
      );
    }
    await this.redis.eval(
      STORE_SOURCES_SCRIPT,
      1,
      sourceMapKey(projectionTurnId),
      ...argumentsList,
    );
    return registered;
  }

  async read(
    projectionTurnId: string,
  ): Promise<ReadonlyMap<string, TurnKnowledgeSource>> {
    const stored = await this.#readStoredSources(projectionTurnId);
    const sources = new Map<string, TurnKnowledgeSource>();
    for (const [sourceRef, storedSource] of stored) {
      sources.set(sourceRef, {
        knowledgeBaseId: storedSource.knowledgeBaseId,
        documentId: storedSource.documentId,
        documentVersionId: storedSource.documentVersionId,
        parentId: storedSource.parentId,
        titlePath: storedSource.titlePath,
        matchedChildIds: storedSource.matchedChildIds,
        pageNumbers: storedSource.pageNumbers,
      });
    }
    return sources;
  }

  async clear(projectionTurnId: string): Promise<void> {
    await this.redis.del(sourceMapKey(projectionTurnId));
  }

  async #readStoredSources(
    projectionTurnId: string,
  ): Promise<ReadonlyMap<string, z.infer<typeof turnKnowledgeSourceSchema>>> {
    const stored = await this.redis.hgetall(sourceMapKey(projectionTurnId));
    const sources = new Map<
      string,
      z.infer<typeof turnKnowledgeSourceSchema>
    >();
    for (const [sourceRef, rawSource] of Object.entries(stored)) {
      try {
        const parsed = turnKnowledgeSourceSchema.safeParse(
          JSON.parse(rawSource),
        );
        if (parsed.success) sources.set(sourceRef, parsed.data);
      } catch {
        // Corrupt or stale transient values fail closed. Other valid handles
        // in the same turn remain usable for citations.
      }
    }
    return sources;
  }
}

function sourceMapKey(projectionTurnId: string): string {
  return `${SOURCE_MAP_KEY_PREFIX}${z.uuid().parse(projectionTurnId)}`;
}

function createSourceRef(): string {
  return randomBytes(24).toString("base64url");
}
