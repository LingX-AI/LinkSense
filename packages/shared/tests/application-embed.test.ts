import { describe, expect, it } from "vitest";

import {
  createApplicationEmbedTicketInputSchema,
  createPublicApplicationEmbedSessionInputSchema,
  updateApplicationExternalAccessInputSchema,
  updateApplicationEmbedExternalApplicationSessionInputSchema,
} from "../src/application-embed.js";

const APP_ID = "lsa_application_identifier";
const ORIGIN = "https://business.example.test";

describe("application embed contracts", () => {
  it("accepts at most four verbatim starter questions for each allowed origin", () => {
    const input = {
      enabled: true,
      auth_mode: "required" as const,
      allowed_origins: [ORIGIN, "https://second.example.test"],
      starter_questions_by_origin: [
        {
          origin: ORIGIN,
          questions: ["How do I apply?", "申请需要哪些材料？"],
        },
      ],
    };

    expect(updateApplicationExternalAccessInputSchema.parse(input)).toEqual(
      input,
    );
    expect(
      updateApplicationExternalAccessInputSchema.safeParse({
        ...input,
        starter_questions_by_origin: [
          {
            origin: ORIGIN,
            questions: ["1", "2", "3", "4", "5"],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      updateApplicationExternalAccessInputSchema.safeParse({
        ...input,
        starter_questions_by_origin: [
          { origin: "https://unapproved.example.test", questions: ["Hi"] },
        ],
      }).success,
    ).toBe(false);
  });

  it("does not accept resume_session_id on authenticated ticket requests", () => {
    const request = {
      app_id: APP_ID,
      app_secret: "lss_application_secret_with_sufficient_entropy",
      origin: ORIGIN,
      external_subject: "business-user-a",
    };

    expect(createApplicationEmbedTicketInputSchema.parse(request)).toEqual(
      request,
    );
    expect(
      createApplicationEmbedTicketInputSchema.safeParse({
        ...request,
        resume_session_id: "50000000-0000-4000-8000-000000000001",
      }).success,
    ).toBe(false);
  });

  it("does not accept resume_session_id on public session requests", () => {
    const request = { app_id: APP_ID, origin: ORIGIN };

    expect(createPublicApplicationEmbedSessionInputSchema.parse(request)).toEqual(
      request,
    );
    expect(
      createPublicApplicationEmbedSessionInputSchema.safeParse({
        ...request,
        resume_session_id: "50000000-0000-4000-8000-000000000001",
      }).success,
    ).toBe(false);
  });

  it("accepts only the optional external application session id binding", () => {
    expect(
      updateApplicationEmbedExternalApplicationSessionInputSchema.parse({
        external_application_session_id: "business-session-a",
      }),
    ).toEqual({ external_application_session_id: "business-session-a" });
    expect(
      updateApplicationEmbedExternalApplicationSessionInputSchema.safeParse({
        external_application_user_id: "business-user-a",
        external_application_session_id: "business-session-a",
      }).success,
    ).toBe(false);
  });
});
