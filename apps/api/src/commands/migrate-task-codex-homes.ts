import { linksenseRuntimeIdentity } from "@linksense/shared"
import { z } from "zod"
import { createPrismaClient } from "../db.js"
import { migrateTaskCodexHomes, type TaskHomeMigrationTask } from "../operations/task-home-migration.js"

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2))
  if ([...args].some((value) => !["--apply", "--workers-stopped"].includes(value))) throw new Error("MIGRATION_ARGUMENTS_INVALID")
  const apply = args.has("--apply")
  if (apply && !args.has("--workers-stopped")) throw new Error("MIGRATION_REQUIRES_STOPPED_WORKERS")
  if (apply && process.platform === "linux" && process.geteuid?.() !== 0) throw new Error("MIGRATION_REQUIRES_ROOT")
  const environment = z.object({ DATABASE_URL: z.string().min(1), LINKSENSE_USER_DATA_ROOT: z.string().min(1) }).parse(process.env)
  const prisma = createPrismaClient(environment.DATABASE_URL)
  try {
    const [running, starting] = await Promise.all([
      prisma.conversationTurn.count({ where: { status: "running" } }),
      prisma.conversationTurnStartIntent.count(),
    ])
    if (apply && (running > 0 || starting > 0)) throw new Error("MIGRATION_ACTIVE_TASKS")
    const tasks: TaskHomeMigrationTask[] = []
    let cursor: string | undefined
    for (;;) {
      const page = await prisma.conversation.findMany({
        take: 500,
        orderBy: { id: "asc" },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, ownerId: true, codexThreadId: true },
      })
      if (!page.length) break
      const turns = await prisma.conversationTurn.findMany({
        where: { conversationId: { in: page.map((task) => task.id) } },
        select: { conversationId: true, codexThreadId: true },
        distinct: ["conversationId", "codexThreadId"],
      })
      for (const task of page) {
        tasks.push({
          ownerId: task.ownerId,
          conversationId: task.id,
          nativeThreadIds: [...new Set([
            ...(task.codexThreadId ? [task.codexThreadId] : []),
            ...turns.filter((turn) => turn.conversationId === task.id).map((turn) => turn.codexThreadId),
          ])],
        })
      }
      cursor = page.at(-1)?.id
    }
    const result = await migrateTaskCodexHomes({
      userDataRoot: environment.LINKSENSE_USER_DATA_ROOT,
      tasks,
      dryRun: !apply,
      ...(process.platform === "linux" ? { ownership: { uid: linksenseRuntimeIdentity.taskUid, gid: linksenseRuntimeIdentity.sharedGid }, controlOwnership: { uid: linksenseRuntimeIdentity.apiUid, gid: linksenseRuntimeIdentity.sharedGid } } : {}),
    })
    process.stdout.write(`${JSON.stringify({ ...result, running, starting })}\n`)
  } finally { await prisma.$disconnect() }
}

main().catch((error: unknown) => {
  const code = error instanceof Error && /^MIGRATION_[A-Z_]+$/.test(error.message) ? error.message : "MIGRATION_FAILED"
  process.stderr.write(`${JSON.stringify({ error_code: code })}\n`)
  process.exitCode = 1
})
