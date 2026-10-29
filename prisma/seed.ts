import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../apps/api/src/generated/prisma/client";
import { initialSettings } from "./initial-settings.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to seed LinkSense.");
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const SYSTEM_SETTINGS_ID = "00000000-0000-4000-8000-000000000001";

async function main(): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { id: SYSTEM_SETTINGS_ID },
    update: {},
    create: {
      id: SYSTEM_SETTINGS_ID,
      settingsJson: initialSettings,
    },
  });
}

main()
  .catch((error: unknown) => {
    console.error("Failed to seed LinkSense system settings.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
