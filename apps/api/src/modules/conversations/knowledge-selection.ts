import {
  knowledgeBaseIdsSchema,
  runnerKnowledgeBaseSelectionSchema,
  type RunnerKnowledgeBaseSelection,
} from "@linksense/shared";

import { AppError } from "../../lib/errors.js";
import type { KnowledgeStore } from "../knowledge/types.js";

type KnowledgeSelectionDatabase = {
  knowledgeBase: {
    findMany(input: {
      where: {
        id: { in: string[] };
        lifecycleStatus: "active";
        availabilityStatus: "enabled";
      };
      select: { id: true; name: true };
    }): Promise<Array<{ id: string; name: string }>>;
  };
};

/** Resolve display metadata from the immutable turn selection, never UI labels. */
export async function resolveRunnerKnowledgeSelection(
  prisma: KnowledgeSelectionDatabase,
  store: Pick<KnowledgeStore, "resolveUsableKnowledgeBaseIds"> | undefined,
  ownerId: string,
  selectedIds: string[],
): Promise<RunnerKnowledgeBaseSelection> {
  const ids = knowledgeBaseIdsSchema.parse(selectedIds);
  if (ids.length === 0) return [];
  if (!store) throw new AppError("KNOWLEDGE_PROCESSING_UNAVAILABLE");
  const usable = new Set(
    await store.resolveUsableKnowledgeBaseIds(ownerId, ids),
  );
  const authorizedIds = ids.filter((id) => usable.has(id));
  const bases = authorizedIds.length === 0
    ? []
    : await prisma.knowledgeBase.findMany({
        where: {
          id: { in: authorizedIds },
          lifecycleStatus: "active",
          availabilityStatus: "enabled",
        },
        select: { id: true, name: true },
      });
  const names = new Map(bases.map((base) => [base.id, base.name]));
  return runnerKnowledgeBaseSelectionSchema.parse(
    ids.map((id) => ({
      id,
      name: usable.has(id) ? names.get(id) ?? null : null,
    })),
  );
}
