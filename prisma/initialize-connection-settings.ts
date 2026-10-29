import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../apps/api/src/generated/prisma/client.js";
import { upgradeConnectionSettings } from "./connection-settings-upgrade.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required to initialize connector settings.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main(): Promise<void> {
  const result = await upgradeConnectionSettings(prisma, {
    masterKey: process.env.LINKSENSE_CREDENTIAL_MASTER_KEY ?? "",
    keyId: process.env.LINKSENSE_CREDENTIAL_KEY_ID ?? "v1",
  });
  console.info("Connector settings ready.", result);
}

main().catch(() => {
  // Errors may contain a failed database query or a credential envelope.
  console.error("Connector settings initialization failed. Check the database and credential encryption configuration before starting the API.");
  process.exitCode = 1;
}).finally(async () => { await prisma.$disconnect(); });
