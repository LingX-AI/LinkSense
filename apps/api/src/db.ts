import { PrismaPg } from "@prisma/adapter-pg"

import { PrismaClient } from "./generated/prisma/client.js"

export function createPrismaClient(databaseUrl?: string): PrismaClient {
  const connectionString = databaseUrl ?? process.env.DATABASE_URL
  if (!connectionString) throw new Error("DATABASE_URL is required")
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  })
}
