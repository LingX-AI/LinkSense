import { Prisma, type TaskCategory as StoredTaskCategory } from "../../generated/prisma/client.js";
import {
  taskCategoryInputSchema,
  taskCategoryOrderSchema,
  taskCategorySchema,
  type TaskCategory,
  type TaskCategoryInput,
  type TaskCategoryOrder,
} from "@linksense/shared";

import { AppError } from "../../lib/errors.js";
import type { TaskCategoryRepository } from "./repository.js";

export class TaskCategoryService {
  constructor(private readonly repository: Pick<TaskCategoryRepository, "list" | "create" | "rename" | "delete" | "reorder">) {}

  async list(ownerId: string): Promise<TaskCategory[]> {
    return (await this.repository.list(ownerId)).map(projectCategory);
  }

  async reorder(ownerId: string, input: TaskCategoryOrder): Promise<TaskCategory[]> {
    const { category_ids } = taskCategoryOrderSchema.parse(input);
    return (await this.repository.reorder(ownerId, category_ids)).map(projectCategory);
  }

  async create(ownerId: string, input: TaskCategoryInput): Promise<TaskCategory> {
    const { name } = taskCategoryInputSchema.parse(input);
    return this.write(() => this.repository.create(ownerId, name));
  }

  async rename(ownerId: string, id: string, input: TaskCategoryInput): Promise<TaskCategory> {
    const { name } = taskCategoryInputSchema.parse(input);
    return this.write(() => this.repository.rename(ownerId, id, name));
  }

  delete(ownerId: string, id: string): Promise<void> {
    return this.repository.delete(ownerId, id);
  }

  private async write(action: () => Promise<StoredTaskCategory>): Promise<TaskCategory> {
    try {
      return projectCategory(await action());
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") throw new AppError("TASK_CATEGORY_NAME_EXISTS");
        if (error.code === "P2025") throw new AppError("TASK_CATEGORY_NOT_FOUND");
      }
      throw error;
    }
  }
}

function projectCategory(row: StoredTaskCategory): TaskCategory {
  return taskCategorySchema.parse({
    id: row.id,
    name: row.name,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  });
}
