import { describe, expect, it, vi } from "vitest";
import { interactiveApplicationManifestSchema } from "@linksense/shared";
import { assertInteractiveDependenciesReady, dependencyBindings, interactiveBindingsComplete, listInteractiveDependencyOptions, resolveInteractiveDependencies, writeInteractiveRuntimeBindings } from "../src/modules/applications/interactive-dependencies.js";

const OWNER = "10000000-0000-4000-8000-000000000001";
const SKILL = "20000000-0000-4000-8000-000000000001";
const OTHER = "20000000-0000-4000-8000-000000000002";
const KB = "30000000-0000-4000-8000-000000000001";
const MCP = "40000000-0000-4000-8000-000000000001";
describe("dependency declaration resource listing", () => {
  it.each(["plugin", "skill", "mcp_server", "knowledge_base"] as const)("scopes every %s page to the owner and available resources, returning only names and IDs", async type => {
    const query = vi.fn().mockResolvedValue([]);
    const db = { capability: { findMany: query }, mcpServer: { findMany: query }, knowledgeBase: { findMany: query } };
    const database = db as unknown as Parameters<typeof listInteractiveDependencyOptions>[0];
    expect(await listInteractiveDependencyOptions(database, OWNER, type, "Review", SKILL)).toEqual({ items: [], next_cursor: null });
    expect(query).toHaveBeenCalledWith({
      select: { id: true, name: true }, orderBy: { id: "asc" }, take: 101,
      where: { ownerId: OWNER, id: { gt: SKILL }, name: { contains: "Review", mode: "insensitive" },
        ...(type === "knowledge_base" ? { lifecycleStatus: "active", availabilityStatus: "enabled" } : { status: "active" }),
        ...(["plugin", "skill"].includes(type) ? { type } : {}),
      },
    });
  });
  it("returns 100 resources and a cursor without losing the lookahead item on the next page", async () => {
    const resources = Array.from({ length: 101 }, (_, i) => ({ id: `20000000-0000-4000-8000-${String(i).padStart(12, "0")}`, name: `Skill ${i}` }));
    const findMany = vi.fn().mockResolvedValueOnce(resources).mockResolvedValueOnce(resources.slice(100));
    const db = { capability: { findMany } } as unknown as Parameters<typeof listInteractiveDependencyOptions>[0];
    const first = await listInteractiveDependencyOptions(db, OWNER, "skill");
    expect(first.items).toEqual(resources.slice(0, 100));
    expect(first.next_cursor).toBe(resources[99]?.id);
    const second = await listInteractiveDependencyOptions(db, OWNER, "skill", undefined, first.next_cursor ?? undefined);
    expect(second).toEqual({ items: resources.slice(100), next_cursor: null });
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { ownerId: OWNER, status: "active", type: "skill", id: { gt: first.next_cursor } } }));
  });
});
function manifest(dependencies: unknown = { skills: [{ id: SKILL, name: "Review" }] }) {
  return interactiveApplicationManifestSchema.parse({ schema_version: 1, id: "review", name: "Review", version: "1", sdk_version: 1, dependencies });
}
function fixture() {
  const resources = [{ id: SKILL, name: "My review", type: "skill", ownerId: OWNER, status: "active" }, { id: OTHER, name: "Alternative", type: "skill", ownerId: OWNER, status: "active" }];
  const db = {
    capability: { findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; ownerId: string; status: string } }) => resources.filter(item => where.id.in.includes(item.id) && item.ownerId === where.ownerId && item.status === where.status)) },
    knowledgeBase: { findMany: vi.fn(async () => [{ id: KB, name: "Policies" }]) },
    mcpServer: { findMany: vi.fn(async () => [{ id: MCP, name: "ERP" }]) },
  };
  return { db, resources, database: db as unknown as Parameters<typeof resolveInteractiveDependencies>[0] };
}
describe("interactive dependency resolution", () => {
  it("automatically matches UUIDs of owned active resources and applies knowledge availability constraints", async () => {
    const { db, database } = fixture();
    const result = await resolveInteractiveDependencies(database, OWNER, manifest({ skills: [{ id: SKILL, name: "Review" }], knowledge_bases: [{ id: KB, name: "Policies" }], mcp_servers: [{ id: MCP, name: "ERP" }] }));
    expect(result.items.every(item => item.available)).toBe(true);
    expect(result.items.map(item => item.resource_id)).toEqual([SKILL, MCP, KB]);
    expect(db.knowledgeBase.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: [KB] }, ownerId: OWNER, lifecycleStatus: "active", availabilityStatus: "enabled" } }));
    expect(db.mcpServer.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: [MCP] }, ownerId: OWNER, status: "active" } }));
  });
  it.each(["other_owner", "disabled", "wrong_type"])("keeps %s resources unmatched without leaking their names", async condition => {
    const { resources, database } = fixture();
    const resource = resources[0];
    if (!resource) throw new Error("fixture missing");
    if (condition === "other_owner") resource.ownerId = OTHER;
    if (condition === "disabled") resource.status = "disabled";
    if (condition === "wrong_type") resource.type = "plugin";
    const result = await resolveInteractiveDependencies(database, OWNER, manifest());
    expect(result.items).toEqual([{ id: SKILL, type: "skill", name: "Review", resource_id: null, resource_name: null, available: false }]);
    await expect(resolveInteractiveDependencies(database, OWNER, manifest(), [], [{ type: "skill", id: SKILL, resource_id: SKILL }])).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
  });
  it("supports manual mapping and explicit skip, preserving both choices across package updates", async () => {
    const { database } = fixture();
    for (const resource_id of [OTHER, null]) {
      const bindings = [{ type: "skill" as const, id: SKILL, resource_id }];
      const selected = await resolveInteractiveDependencies(database, OWNER, manifest(), [], bindings);
      expect(dependencyBindings(selected)).toEqual(bindings);
      expect(dependencyBindings(await resolveInteractiveDependencies(database, OWNER, manifest(), bindings))).toEqual(bindings);
    }
  });
  it("drops removed declarations and automatically matches new declarations", async () => {
    const { database } = fixture();
    const result = await resolveInteractiveDependencies(database, OWNER, manifest({ skills: [{ id: OTHER, name: "New" }] }), [{ type: "skill", id: SKILL, resource_id: OTHER }]);
    expect(dependencyBindings(result)).toEqual([{ type: "skill", id: OTHER, resource_id: OTHER }]);
    await expect(resolveInteractiveDependencies(database, OWNER, manifest(), [], [{ type: "skill", id: OTHER, resource_id: SKILL }])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
  it("retains unavailable saved mappings for repair and blocks execution or publication", async () => {
    const { database, resources } = fixture();
    resources.splice(0);
    const bindings = [{ type: "skill" as const, id: SKILL, resource_id: OTHER }];
    expect(dependencyBindings(await resolveInteractiveDependencies(database, OWNER, manifest(), bindings))).toEqual(bindings);
    await expect(assertInteractiveDependenciesReady(database, OWNER, manifest(), bindings)).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
    await expect(assertInteractiveDependenciesReady(database, OWNER, manifest(), [])).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
    expect(interactiveBindingsComplete(manifest(), [])).toBe(false);
  });
  it("does not add implicit bindings while reading readiness and permits old packages with no declarations", async () => {
    const { database } = fixture();
    await expect(assertInteractiveDependenciesReady(database, OWNER, manifest(), [])).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
    await expect(assertInteractiveDependenciesReady(database, OWNER, manifest({}), [])).resolves.toBeUndefined();
    expect(interactiveBindingsComplete(manifest({}), [])).toBe(true);
  });
  it("deduplicates actual resources while retaining every declaration and clears removed bindings", async () => {
    const { database } = fixture();
    const result = await resolveInteractiveDependencies(database, OWNER, manifest({ skills: [{ id: SKILL, name: "Review" }, { id: OTHER, name: "Alternative" }] }), [], [{ type: "skill", id: OTHER, resource_id: SKILL }]);
    const table = () => ({ deleteMany: vi.fn(), createMany: vi.fn() });
    const tx = { applicationCapability: table(), applicationKnowledgeBase: table(), applicationMcpServer: table() };
    await writeInteractiveRuntimeBindings(tx as unknown as Parameters<typeof writeInteractiveRuntimeBindings>[0], OWNER, result, true);
    expect(dependencyBindings(result)).toHaveLength(2);
    expect(tx.applicationCapability.createMany).toHaveBeenCalledWith({ data: [{ applicationId: OWNER, capabilityId: SKILL, capabilityNameSnapshot: "My review", capabilityTypeSnapshot: "skill", selectionOrder: 0 }] });
    expect(tx.applicationKnowledgeBase.deleteMany).toHaveBeenCalledWith({ where: { applicationId: OWNER } });
    expect(tx.applicationMcpServer.deleteMany).toHaveBeenCalledWith({ where: { applicationId: OWNER } });
  });
});
