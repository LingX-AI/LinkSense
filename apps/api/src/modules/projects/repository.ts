import { Prisma, type PrismaClient, type Project } from "../../generated/prisma/client.js";
import { APPLICATION_DEVELOPMENT_PROJECT_NAME, type ProjectInput } from "@linksense/shared";

import { AppError } from "../../lib/errors.js";
import { projectWorkspaceRelativePath } from "../../lib/user-runtime-paths.js";
import { assertProjectTasksIdle, assertProjectHasNoApplicationSources } from "./runtime-state.js";

const projectOrder = [
  { sortOrder: { sort: "asc", nulls: "last" } },
  { createdAt: "asc" },
  { id: "asc" },
] satisfies Prisma.ProjectOrderByWithRelationInput[];

// Assignment locks the destination before locking/writing a task. Deletion
// takes the exclusive project lock first, so it cannot leave orphaned tasks.
export async function lockOwnedProject(
  tx: Prisma.TransactionClient,
  ownerId: string,
  projectId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM projects
    WHERE id = ${projectId}::uuid AND owner_id = ${ownerId}::uuid
    FOR SHARE
  `);
  if (rows.length === 0) throw new AppError("PROJECT_NOT_FOUND");
}

export class ProjectRepository {
  constructor(private readonly prisma: PrismaClient) {}

  list(ownerId: string): Promise<Project[]> {
    return this.prisma.project.findMany({
      where: { ownerId },
      orderBy: projectOrder,
    });
  }

  async reorder(ownerId: string, projectIds: string[]): Promise<Project[]> {
    return this.prisma.$transaction(async (tx) => {
      // Lock in a stable order so simultaneous sorts cannot interleave writes.
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM projects
        WHERE owner_id = ${ownerId}::uuid
        ORDER BY id
        FOR UPDATE
      `);
      const ownedIds = new Set(rows.map((row) => row.id));
      if (projectIds.some((id) => !ownedIds.has(id))) {
        throw new AppError("PROJECT_NOT_FOUND");
      }
      if (projectIds.length !== ownedIds.size || new Set(projectIds).size !== projectIds.length) {
        throw new AppError("CONFLICT");
      }
      // Only ordering changes: names, task assignments and timestamps stay intact.
      await tx.$executeRaw(Prisma.sql`
        UPDATE projects AS project
        SET sort_order = (ordering.position - 1)::integer
        FROM unnest(ARRAY[${Prisma.join(projectIds)}]::uuid[])
          WITH ORDINALITY AS ordering(id, position)
        WHERE project.id = ordering.id AND project.owner_id = ${ownerId}::uuid
      `);
      return tx.project.findMany({ where: { ownerId }, orderBy: projectOrder });
    });
  }

  create(ownerId: string, input: ProjectInput): Promise<Project> {
    return this.prisma.project.create({ data: { ownerId, ...projectWriteData(input) } });
  }

  update(ownerId: string, id: string, input: ProjectInput): Promise<Project> {
    return this.prisma.$transaction(async tx => {
      const [current] = await tx.$queryRaw<Array<{ name: string }>>(Prisma.sql`
        SELECT name FROM projects WHERE id = ${id}::uuid AND owner_id = ${ownerId}::uuid FOR UPDATE
      `);
      if (!current) throw new AppError("PROJECT_NOT_FOUND");
      if (current.name === APPLICATION_DEVELOPMENT_PROJECT_NAME && input.name !== current.name) {
        throw new AppError("APPLICATION_DEVELOPMENT_PROJECT_NAME_FIXED");
      }
      return tx.project.update({ where: { id, ownerId }, data: projectWriteData(input) });
    });
  }

  async delete(ownerId: string, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM projects
        WHERE id = ${id}::uuid AND owner_id = ${ownerId}::uuid
        FOR UPDATE
      `);
      if (rows.length === 0) throw new AppError("PROJECT_NOT_FOUND");
      await assertProjectHasNoApplicationSources(tx, ownerId, id);
      const tasks = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM conversations
        WHERE owner_id = ${ownerId}::uuid AND project_id = ${id}::uuid
        ORDER BY id FOR UPDATE
      `);
      await assertProjectTasksIdle(tx, tasks.map(task => task.id));
      // Include archived tasks; preserve pin order and task activity timestamps.
      await tx.$executeRaw(Prisma.sql`
        UPDATE conversations
        SET project_id = NULL,
            workspace_rel_path = CASE WHEN workspace_rel_path LIKE ${`${ownerId}/services/%`} THEN workspace_rel_path ELSE ${projectWorkspaceRelativePath(ownerId, null)} END,
            sort_order = CASE WHEN pinned_at IS NULL THEN NULL ELSE sort_order END
        WHERE owner_id = ${ownerId}::uuid AND project_id = ${id}::uuid
      `);
      await tx.project.delete({ where: { id, ownerId } });
    });
  }
}

function projectWriteData(input: ProjectInput): Pick<Prisma.ProjectCreateInput, "name" | "icon" | "color"> {
  return {
    name: input.name,
    ...(input.icon === undefined ? {} : { icon: input.icon }),
    ...(input.color === undefined ? {} : { color: input.color }),
  };
}
