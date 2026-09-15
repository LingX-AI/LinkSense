import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { AppError } from "./errors.js";

type PrincipalStore = Pick<PrismaClient, "user" | "applicationExternalSession" | "applicationExternalAccess" | "application">;

/** External visitors are session principals, with no login account or personal inventory. */
export async function executionPrincipalStatus(store: PrincipalStore, id: string): Promise<"active" | "disabled"> {
  const user = await store.user.findUnique({ where: { id }, select: { status: true } });
  if (user) return user.status === "active" ? "active" : "disabled";
  const session = await store.applicationExternalSession.findUnique({ where: { runtimePrincipalId: id } });
  if (!session || session.status !== "active" || session.absoluteExpiresAt <= new Date()) return "disabled";
  const [access, application] = await Promise.all([
    store.applicationExternalAccess.findUnique({ where: { id: session.externalAccessId }, select: { enabled: true, applicationId: true, credentialVersion: true } }),
    store.application.findUnique({ where: { id: session.applicationId }, select: { status: true } }),
  ]);
  return access?.enabled && access.applicationId === session.applicationId && access.credentialVersion === session.credentialVersion && application?.status === "active" ? "active" : "disabled";
}

export async function lockExecutionPrincipal(tx: Prisma.TransactionClient, id: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${id}::uuid FOR UPDATE`);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM application_external_sessions WHERE runtime_principal_id = ${id}::uuid FOR UPDATE`);
}

export async function assertExecutionPrincipalActive(store: PrincipalStore, id: string): Promise<void> {
  if (await executionPrincipalStatus(store, id) !== "active") throw new AppError("USER_DISABLED");
}
