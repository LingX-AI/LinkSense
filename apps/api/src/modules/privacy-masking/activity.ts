import {
  PRIVACY_MASKING_ACTIVITY_PAGE_SIZE,
  PRIVACY_MASKING_ACTIVITY_RETENTION_DAYS,
  privacyMaskingActivityResponseSchema,
  type PrivacyMaskingActivityResponse,
  type RunnerPrivacyMaskingCapture,
} from "@linksense/shared";

import type { PrismaClient } from "../../generated/prisma/client.js";

const dayMs = 24 * 60 * 60 * 1000;

/**
 * Counts-only activity for the masking settings page. One row per model
 * request that had values replaced; origins and placeholders are never
 * stored. Rows expire after the retention window.
 */
export class PrivacyMaskingActivityService {
  constructor(private readonly prisma: PrismaClient) {}

  async record(capture: RunnerPrivacyMaskingCapture): Promise<void> {
    const createdAt = new Date(capture.observed_at);
    const cutoff = new Date(
      createdAt.getTime() -
        PRIVACY_MASKING_ACTIVITY_RETENTION_DAYS * dayMs,
    );
    await this.prisma.$transaction([
      this.prisma.userPrivacyMaskingRecord.createMany({
        data: [
          {
            userId: capture.owner_id,
            conversationId: capture.conversation_id,
            turnId: capture.turn_id,
            requestId: capture.request_id,
            model: capture.model,
            maskedCount: capture.masked_count,
            kinds: capture.kinds,
            createdAt,
          },
        ],
        skipDuplicates: true,
      }),
      this.prisma.userPrivacyMaskingRecord.deleteMany({
        where: { userId: capture.owner_id, createdAt: { lt: cutoff } },
      }),
    ]);
  }

  async listForUser(
    userId: string,
    query: { days: number; before?: string | undefined },
  ): Promise<PrivacyMaskingActivityResponse> {
    const since = new Date(Date.now() - query.days * dayMs);
    const [summary, rows] = await Promise.all([
      this.prisma.userPrivacyMaskingRecord.aggregate({
        where: { userId, createdAt: { gte: since } },
        _sum: { maskedCount: true },
        _count: { _all: true },
      }),
      this.prisma.userPrivacyMaskingRecord.findMany({
        where: {
          userId,
          createdAt: {
            gte: since,
            ...(query.before ? { lt: new Date(query.before) } : {}),
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: PRIVACY_MASKING_ACTIVITY_PAGE_SIZE + 1,
      }),
    ]);
    const page = rows.slice(0, PRIVACY_MASKING_ACTIVITY_PAGE_SIZE);
    const last = page.at(-1);
    return privacyMaskingActivityResponseSchema.parse({
      summary: {
        masked_count: summary._sum.maskedCount ?? 0,
        request_count: summary._count._all,
      },
      records: page.map((row) => ({
        id: row.id,
        model: row.model,
        masked_count: row.maskedCount,
        kinds: row.kinds,
        created_at: row.createdAt.toISOString(),
      })),
      next_before:
        rows.length > PRIVACY_MASKING_ACTIVITY_PAGE_SIZE && last
          ? last.createdAt.toISOString()
          : null,
    });
  }
}
