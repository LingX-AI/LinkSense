import type { Duplex } from "node:stream"

import { PrismaPg } from "@prisma/adapter-pg"

import { PrismaClient, type Prisma } from "./generated/prisma/client.js"

type PrismaClientFactoryOptions = {
  /** Additional pg pool settings; the connection string always comes from this factory. */
  pool?: {
    max?: number
    /** pg-pool removes the connection after this many releases. */
    maxUses?: number
    connectionTimeoutMillis?: number
    application_name?: string
    /** Raw transport factory, used to bound a connection's whole lifetime. */
    stream?: () => Duplex
  }
  log?: Prisma.LogLevel[]
}

export function createPrismaClient(
  databaseUrl?: string,
  options: PrismaClientFactoryOptions = {},
): PrismaClient {
  const connectionString = databaseUrl ?? process.env.DATABASE_URL
  if (!connectionString) throw new Error("DATABASE_URL is required")
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString, ...options.pool }),
    log:
      options.log ??
      (process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"]),
  })
}
