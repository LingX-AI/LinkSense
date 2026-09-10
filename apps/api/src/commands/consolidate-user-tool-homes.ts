import { linksenseRuntimeIdentity } from "@linksense/shared"
import { z } from "zod"
import { createPrismaClient } from "../db.js"
import { consolidateUserToolHomes } from "../operations/shared-user-home-migration.js"

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2))
  if ([...args].some(arg => !["--apply", "--workers-stopped"].includes(arg))) throw new Error("MIGRATION_ARGUMENTS_INVALID")
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
    if (apply && (running || starting)) throw new Error("MIGRATION_ACTIVE_TASKS")
    const tasks: Array<{ ownerId: string; conversationId: string }> = []
    let cursor: string | undefined
    for (;;) {
      const page = await prisma.conversation.findMany({
        select: { id: true, ownerId: true }, take: 500, orderBy: { id: "asc" },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })
      tasks.push(...page.map(task => ({ ownerId: task.ownerId, conversationId: task.id })))
      if (page.length < 500) break
      cursor = page.at(-1)?.id
    }
    const result = await consolidateUserToolHomes({
      userDataRoot: environment.LINKSENSE_USER_DATA_ROOT, tasks, dryRun: !apply,
      ...(process.platform === "linux" ? { ownership: { uid: linksenseRuntimeIdentity.taskUid, gid: linksenseRuntimeIdentity.sharedGid } } : {}),
    })
    process.stdout.write(`${JSON.stringify({ ...result, running, starting })}\n`)
    if (result.conflicts.length) process.exitCode = 1
  } finally { await prisma.$disconnect() }
}

main().catch((error: unknown) => {
  const code = error instanceof Error && /^MIGRATION_[A-Z_]+$/.test(error.message) ? error.message : "MIGRATION_FAILED"
  process.stderr.write(`${JSON.stringify({ error_code: code })}\n`)
  process.exitCode = 1
})
