import { lstat, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { userEnvironmentSettingsSchema, type UserEnvironmentSettings } from "@linksense/shared";
import { z } from "zod";

import { writeSharedRegularFileAtomically } from "../workspace/filesystem.js";

/** Supervisor-owned preferences survive container reclamation. */
export class UserEnvironmentSettingsStore {
  constructor(private readonly root: string) {}

  async get(ownerId: string): Promise<UserEnvironmentSettings> {
    const file = await this.fileFor(ownerId, false);
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 1_024) {
        throw new Error("invalid environment settings boundary");
      }
      return userEnvironmentSettingsSchema.parse(JSON.parse(await readFile(file, "utf8")));
    } catch (error) {
      if (isMissing(error)) return { keep_running: false };
      throw error;
    }
  }

  async set(ownerId: string, input: UserEnvironmentSettings): Promise<UserEnvironmentSettings> {
    const settings = userEnvironmentSettingsSchema.parse(input);
    const file = await this.fileFor(ownerId, true);
    await writeSharedRegularFileAtomically(file, JSON.stringify(settings), 0o600);
    return settings;
  }

  private async fileFor(ownerId: string, create: boolean): Promise<string> {
    const id = z.uuid().parse(ownerId).toLowerCase();
    let directory = path.resolve(this.root);
    for (const segment of ["", id, "control"]) {
      directory = path.join(directory, segment);
      try {
        if (create) await mkdir(directory, { mode: 0o700 });
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      }
      try {
        const info = await lstat(directory);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("invalid environment settings boundary");
      } catch (error) {
        if (isMissing(error) && !create) break;
        throw error;
      }
    }
    return path.join(path.resolve(this.root), id, "control", "environment.json");
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
