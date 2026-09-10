import { Prisma, type PrismaClient, type TaskCategory } from "../../generated/prisma/client.js";

import { AppError } from "../../lib/errors.js";

const categoryOrder = [
  { sortOrder: { sort: "asc", nulls: "last" } },
  { createdAt: "asc" },
  { id: "asc" },
] satisfies Prisma.TaskCategoryOrderByWithRelationInput[];

// Assignment locks the destination before locking/writing a task. Deletion
// takes the exclusive category lock first, so it cannot leave orphaned tasks.
export async function lockOwnedTaskCategory(
  tx: Prisma.TransactionClient,
  ownerId: string,
  categoryId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM task_categories
    WHERE id = ${categoryId}::uuid AND owner_id = ${ownerId}::uuid
    FOR SHARE
  `);
  if (rows.length === 0) throw new AppError("TASK_CATEGORY_NOT_FOUND");
}

export class TaskCategoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  list(ownerId: string): Promise<TaskCategory[]> {
    return this.prisma.taskCategory.findMany({
      where: { ownerId },
      orderBy: categoryOrder,
    });
  }

  async reorder(ownerId: string, categoryIds: string[]): Promise<TaskCategory[]> {
    return this.prisma.$transaction(async (tx) => {
      // Lock in a stable order so simultaneous sorts cannot interleave writes.
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM task_categories
        WHERE owner_id = ${ownerId}::uuid
        ORDER BY id
        FOR UPDATE
      `);
      const ownedIds = new Set(rows.map((row) => row.id));
      if (categoryIds.some((id) => !ownedIds.has(id))) {
        throw new AppError("TASK_CATEGORY_NOT_FOUND");
      }
      if (categoryIds.length !== ownedIds.size || new Set(categoryIds).size !== categoryIds.length) {
        throw new AppError("CONFLICT");
      }
      // Only ordering changes: names, task assignments and timestamps stay intact.
      await tx.$executeRaw(Prisma.sql`
        UPDATE task_categories AS category
        SET sort_order = (ordering.position - 1)::integer
        FROM unnest(ARRAY[${Prisma.join(categoryIds)}]::uuid[])
          WITH ORDINALITY AS ordering(id, position)
        WHERE category.id = ordering.id AND category.owner_id = ${ownerId}::uuid
      `);
      return tx.taskCategory.findMany({ where: { ownerId }, orderBy: categoryOrder });
    });
  }

  create(ownerId: string, name: string): Promise<TaskCategory> {
    return this.prisma.taskCategory.create({ data: { ownerId, name } });
  }

  rename(ownerId: string, id: string, name: string): Promise<TaskCategory> {
    return this.prisma.taskCategory.update({
      where: { id, ownerId },
      data: { name },
    });
  }

  async delete(ownerId: string, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM task_categories
        WHERE id = ${id}::uuid AND owner_id = ${ownerId}::uuid
        FOR UPDATE
      `);
      if (rows.length === 0) throw new AppError("TASK_CATEGORY_NOT_FOUND");
      // Include archived tasks; preserve pin order and task activity timestamps.
      await tx.$executeRaw(Prisma.sql`
        UPDATE conversations
        SET category_id = NULL,
            sort_order = CASE WHEN pinned_at IS NULL THEN NULL ELSE sort_order END
        WHERE owner_id = ${ownerId}::uuid AND category_id = ${id}::uuid
      `);
      await tx.taskCategory.delete({ where: { id, ownerId } });
    });
  }
}
