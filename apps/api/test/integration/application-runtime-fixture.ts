import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { ApplicationRuntimeGate } from "../../src/modules/applications/runtime-gate.js";
import { ApplicationRuntimeInstallationService } from "../../src/modules/applications/runtime-installation-service.js";
import { ApplicationPublicationService } from "../../src/modules/applications/publication-service.js";

// Serial database fixtures use a local lease adapter; the runtime-installation
// PostgreSQL suite separately exercises actual Redis with two independent clients.
export function applicationRuntimeFixture(prisma: PrismaClient, publications: ApplicationPublicationService) {
  const readers = new Map<string, Set<string>>(), writers = new Map<string, string>();
  const store = {
    acquireUserRuntimeLease: async (key: string) => { if (writers.has(key)) return null; const token = randomUUID(); const set = readers.get(key) ?? new Set<string>(); set.add(token); readers.set(key, set); return token; },
    renewUserRuntimeLease: async (key: string, token: string) => readers.get(key)?.has(token) ?? false,
    releaseUserRuntimeLease: async (key: string, token: string) => { readers.get(key)?.delete(token); },
    acquireUserLifecycleLock: async (key: string) => { if (writers.has(key) || readers.get(key)?.size) return null; const token = randomUUID(); writers.set(key, token); return token; },
    renewUserLifecycleLock: async (key: string, token: string) => writers.get(key) === token,
    releaseUserLifecycleLock: async (key: string, token: string) => { if (writers.get(key) === token) writers.delete(key); },
  };
  const gate = new ApplicationRuntimeGate(prisma, store, async () => {});
  return { gate, selections: new ApplicationRuntimeInstallationService(prisma, publications, gate) };
}
