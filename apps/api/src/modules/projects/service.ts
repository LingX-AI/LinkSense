import { Prisma, type Project as StoredProject } from "../../generated/prisma/client.js";
import {
  projectInputSchema,
  projectOrderSchema,
  projectSchema,
  type Project,
  type ProjectInput,
  type ProjectOrder,
} from "@linksense/shared";

import { AppError } from "../../lib/errors.js";
import type { ProjectRepository } from "./repository.js";

export class ProjectService {
  constructor(private readonly repository: Pick<ProjectRepository, "list" | "create" | "rename" | "delete" | "reorder">) {}

  async list(ownerId: string): Promise<Project[]> {
    return (await this.repository.list(ownerId)).map(projectCategory);
  }

  async reorder(ownerId: string, input: ProjectOrder): Promise<Project[]> {
    const { project_ids } = projectOrderSchema.parse(input);
    return (await this.repository.reorder(ownerId, project_ids)).map(projectCategory);
  }

  async create(ownerId: string, input: ProjectInput): Promise<Project> {
    const { name } = projectInputSchema.parse(input);
    return this.write(() => this.repository.create(ownerId, name));
  }

  async rename(ownerId: string, id: string, input: ProjectInput): Promise<Project> {
    const { name } = projectInputSchema.parse(input);
    return this.write(() => this.repository.rename(ownerId, id, name));
  }

  delete(ownerId: string, id: string): Promise<void> {
    return this.repository.delete(ownerId, id);
  }

  private async write(action: () => Promise<StoredProject>): Promise<Project> {
    try {
      return projectCategory(await action());
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") throw new AppError("PROJECT_NAME_EXISTS");
        if (error.code === "P2025") throw new AppError("PROJECT_NOT_FOUND");
      }
      throw error;
    }
  }
}

function projectCategory(row: StoredProject): Project {
  return projectSchema.parse({
    id: row.id,
    name: row.name,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  });
}
