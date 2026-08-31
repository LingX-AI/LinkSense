import { describe, expect, it } from "vitest";

import { TurnKnowledgeSourceStore } from "../src/modules/events/knowledge-source-store.js";

const TURN_ID = "00000000-0000-4000-8000-000000000001";
const ASSET_ID = "00000000-0000-5000-8000-000000000005";
const DOCUMENT_ASSET_ID = "00000000-0000-5000-8000-000000000006";
const SOURCE = {
  knowledgeBaseId: "00000000-0000-4000-8000-000000000002",
  documentId: "00000000-0000-4000-8000-000000000003",
  documentVersionId: "00000000-0000-4000-8000-000000000004",
  parentId: "parent-1",
  titlePath: ["第三章"],
  matchedChildIds: ["child-1", "child-2"],
  pageNumbers: [3, 4],
};

class FakeRedis {
  readonly hashes = new Map<string, Record<string, string>>();
  readonly expirations = new Map<string, number>();

  async eval(
    _script: string,
    _numberOfKeys: number,
    key: string | number,
    ttl: string | number,
    ...entries: Array<string | number>
  ) {
    const normalizedKey = String(key);
    const hash = this.hashes.get(normalizedKey) ?? {};
    for (let index = 0; index < entries.length; index += 2) {
      hash[String(entries[index])] = String(entries[index + 1]);
    }
    this.hashes.set(normalizedKey, hash);
    this.expirations.set(normalizedKey, Number(ttl));
    return Object.keys(hash).length;
  }

  async hgetall(key: string) {
    return this.hashes.get(key) ?? {};
  }

  async del(key: string) {
    const existed = this.hashes.delete(key);
    this.expirations.delete(key);
    return existed ? 1 : 0;
  }
}

describe("TurnKnowledgeSourceStore", () => {
  it("registers opaque handles with a finite turn-scoped TTL", async () => {
    const redis = new FakeRedis();
    const store = new TurnKnowledgeSourceStore(redis, 123);

    const [registered] = await store.register(TURN_ID, [SOURCE]);

    expect(registered?.sourceRef).toMatch(/^[A-Za-z0-9_-]{32}$/u);
    expect(redis.expirations.values().next().value).toBe(123);
    expect(await store.read(TURN_ID)).toEqual(
      new Map([[registered!.sourceRef, SOURCE]]),
    );
  });

  it("accumulates sources returned by multiple searches in the same turn", async () => {
    const redis = new FakeRedis();
    const store = new TurnKnowledgeSourceStore(redis);

    const first = await store.register(TURN_ID, [SOURCE]);
    const second = await store.register(TURN_ID, [
      { ...SOURCE, parentId: "parent-2" },
    ]);
    const stored = await store.read(TURN_ID);

    expect(stored.size).toBe(2);
    expect(stored.get(first[0]!.sourceRef)?.parentId).toBe("parent-1");
    expect(stored.get(second[0]!.sourceRef)?.parentId).toBe("parent-2");
  });

  it("keeps live asset references separate from citation projection", async () => {
    const redis = new FakeRedis();
    const store = new TurnKnowledgeSourceStore(redis);
    const [registered] = await store.register(TURN_ID, [
      { ...SOURCE, assetReferenceIds: [ASSET_ID] },
    ]);

    expect(await store.read(TURN_ID)).toEqual(
      new Map([[registered!.sourceRef, SOURCE]]),
    );
    expect(await store.readAssetSources(TURN_ID)).toEqual([
      { ...SOURCE, assetReferenceIds: [ASSET_ID] },
    ]);
  });

  it("registers full-document assets without exposing synthetic citation handles", async () => {
    const redis = new FakeRedis();
    const store = new TurnKnowledgeSourceStore(redis);

    await store.registerAssetSources(TURN_ID, [
      {
        knowledgeBaseId: SOURCE.knowledgeBaseId,
        documentId: SOURCE.documentId,
        documentVersionId: SOURCE.documentVersionId,
        assetReferenceIds: [DOCUMENT_ASSET_ID],
      },
    ]);

    expect(await store.read(TURN_ID)).toEqual(new Map());
    expect(await store.readAssetSources(TURN_ID)).toEqual([
      {
        knowledgeBaseId: SOURCE.knowledgeBaseId,
        documentId: SOURCE.documentId,
        documentVersionId: SOURCE.documentVersionId,
        assetReferenceIds: [DOCUMENT_ASSET_ID],
      },
    ]);
  });

  it("reads rolling-restart entries without live asset authorization", async () => {
    const redis = new FakeRedis();
    const store = new TurnKnowledgeSourceStore(redis);
    const [registered] = await store.register(TURN_ID, [SOURCE]);
    const [key] = redis.hashes.keys();
    const raw = JSON.parse(redis.hashes.get(key!)![registered!.sourceRef]!);
    delete raw.assetReferenceIds;
    redis.hashes.get(key!)![registered!.sourceRef] = JSON.stringify(raw);

    expect(await store.read(TURN_ID)).toEqual(
      new Map([[registered!.sourceRef, SOURCE]]),
    );
    expect(await store.readAssetSources(TURN_ID)).toEqual([
      { ...SOURCE, assetReferenceIds: [] },
    ]);
  });

  it("ignores corrupt transient entries and clears the map explicitly", async () => {
    const redis = new FakeRedis();
    const store = new TurnKnowledgeSourceStore(redis);
    const [registered] = await store.register(TURN_ID, [SOURCE]);
    const [key] = redis.hashes.keys();
    redis.hashes.get(key!)!.corrupt = "not-json";

    expect(await store.read(TURN_ID)).toEqual(
      new Map([[registered!.sourceRef, SOURCE]]),
    );
    await store.clear(TURN_ID);
    expect(await store.read(TURN_ID)).toEqual(new Map());
  });

  it("does not create a Redis key for an empty result set", async () => {
    const redis = new FakeRedis();
    const store = new TurnKnowledgeSourceStore(redis);

    expect(await store.register(TURN_ID, [])).toEqual([]);
    expect(redis.hashes.size).toBe(0);
  });
});
