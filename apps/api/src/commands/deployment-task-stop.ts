import { parseConfig } from "../config.js";
import { createPrismaClient } from "../db.js";
import { LinkSenseRedis } from "../adapters/redis.js";
import {
  interruptDeploymentTasks,
  listDeploymentInterruptTargets,
  parseDeploymentStopCommand,
  settleDeploymentTasks,
} from "../operations/deployment-task-stop.js";

async function main(): Promise<void> {
  const command = parseDeploymentStopCommand(process.argv.slice(2));
  const config = parseConfig();
  const prisma = createPrismaClient(config.databaseUrl);
  const redis = new LinkSenseRedis(config);
  // Includes dependency connection and query time, not just HTTP cancellation.
  const deadline = setTimeout(
    () => {
      process.stderr.write(
        "Deployment task operation exceeded its deadline.\n",
      );
      process.exit(1);
    },
    command === "interrupt" ? 5_000 : 90_000,
  );
  try {
    if (command === "interrupt") {
      const result = await interruptDeploymentTasks(
        await listDeploymentInterruptTargets(prisma),
        {
          baseUrl: config.runnerUrl,
          secret: config.runnerSharedSecret,
          signal: AbortSignal.timeout(4_000),
        },
      );
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
      await redis.connect();
      process.stdout.write(
        `${JSON.stringify(await settleDeploymentTasks(prisma, redis))}\n`,
      );
    }
  } finally {
    await Promise.allSettled([prisma.$disconnect(), redis.close()]);
    clearTimeout(deadline);
  }
}

main().catch(() => {
  process.stderr.write(
    "Deployment task operation failed; sensitive details were suppressed.\n",
  );
  process.exitCode = 1;
});
