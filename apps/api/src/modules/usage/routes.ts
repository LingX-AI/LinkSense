import {
  billingStatementPdfQuerySchema,
  personalUsageProfileQuerySchema,
  personalQuotaQuerySchema,
  personalQuotaReportSchema,
  productFilenamePrefix,
  usageAnalyticsReportQuerySchema,
} from "@linksense/shared";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { attachmentContentDisposition } from "../../lib/content-disposition.js";
import { ok } from "../../lib/http.js";
import { translateBackend } from "../../lib/i18n.js";
import { resolveLocale } from "../../lib/locale.js";
import type { AuthenticatedRequest } from "../../plugins/authentication.js";
import type { AppServices } from "../../services.js";
import { buildUsageAnalyticsWorkbook } from "./export-workbook.js";

export const personalUsageRoutes: FastifyPluginAsync<{
  services: AppServices;
}> = async (app, { services }) => {
  app.addHook("preHandler", app.authenticate);

  app.get("/quota", async (request, reply) => {
    const actor = (request as AuthenticatedRequest).authUser;
    const query = personalQuotaQuerySchema.parse(request.query);
    const [overview, analytics] = await Promise.all([
      services.creditLimits.personalOverview(actor.id),
      services.usageAnalytics.personalQuota(actor.id, query),
    ]);
    return reply.header("cache-control", "private, no-store").send(
      ok(personalQuotaReportSchema.parse({ overview, analytics }), request.id),
    );
  });

  app.get("/", async (request, reply) => {
    const actor = (request as AuthenticatedRequest).authUser;
    const query = personalUsageProfileQuerySchema.parse(request.query);
    const profile = await services.usageAnalytics.personalProfile(
      actor.id,
      query,
    );
    return reply
      .header("cache-control", "private, no-store")
      .send(ok(profile, request.id));
  });
};

export const usageAnalyticsRoutes: FastifyPluginAsync<{
  services: AppServices;
}> = async (app, { services }) => {
  app.addHook("preHandler", app.requireAdmin);

  app.get("/", async (request, reply) => {
    const query = usageAnalyticsReportQuerySchema.parse(request.query);
    const report = await services.usageAnalytics.report(query);
    return reply.send(ok(report, request.id));
  });

  app.get("/export.xlsx", async (request, reply) => {
    const actor = (request as AuthenticatedRequest).authUser;
    const query = usageAnalyticsReportQuerySchema.parse(request.query);
    const report = await services.usageAnalytics.report(query);
    const productSettings = await services.system.getProductSettings();
    const locale = resolveLocale(
      request,
      actor.preferredLocale,
      productSettings.default_locale,
    );
    const workbook = await buildUsageAnalyticsWorkbook({
      report,
      locale,
      productName: productSettings.organization_display_name,
    });

    await services.audit.write({
      actorId: actor.id,
      action: "usage_exported",
      result: "success",
      metadata: {
        row_count: workbook.dataRowCount,
        format: "xlsx",
        range: report.range,
      },
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
    });

    return reply
      .header(
        "content-type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      )
      .header("cache-control", "no-store")
      .header("x-content-type-options", "nosniff")
      .header("referrer-policy", "no-referrer")
      .header(
        "content-disposition",
        attachmentContentDisposition(
          translateBackend("usageExport.filename", locale, {
            productPrefix: productFilenamePrefix(
              productSettings.organization_display_name,
            ),
          }),
        ),
      )
      .send(workbook.buffer);
  });

  app.get("/bills", async (request, reply) => {
    const statements = await services.billingStatements.list();
    return reply
      .header("cache-control", "private, no-store")
      .send(ok(statements, request.id));
  });

  app.get("/bills/:statementId", async (request, reply) => {
    const params = billingStatementParamsSchema.parse(request.params);
    const statement = await services.billingStatements.detail(
      params.statementId,
    );
    return reply
      .header("cache-control", "private, no-store")
      .send(ok(statement, request.id));
  });

  app.post("/bills/:statementId/export", async (request, reply) => {
    const actor = (request as AuthenticatedRequest).authUser;
    const params = billingStatementParamsSchema.parse(request.params);
    const query = billingStatementPdfQuerySchema.parse(request.query);
    const statement = await services.billingStatements.detail(
      params.statementId,
    );
    await services.audit.write({
      actorId: actor.id,
      action: "billing_statement_exported",
      result: "success",
      metadata: {
        statement_id: statement.id,
        statement_number: statement.statement_number,
        format: "pdf",
        locale: query.locale ?? actor.preferredLocale,
      },
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
    });
    return reply
      .header("cache-control", "private, no-store")
      .send(ok(statement, request.id));
  });
};

const billingStatementParamsSchema = z.strictObject({
  statementId: z.uuid(),
});
