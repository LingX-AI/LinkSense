import { describe, expect, it } from "vitest";

import {
  authSessionSchema,
  authUserSchema,
  initializeSystemResultSchema,
} from "../src/auth.js";

const authUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "person@example.com",
  name: "Person",
  avatar_object_key: null,
  role: "admin",
  status: "active",
  preferred_locale: "zh-CN",
  running_message_action: "queue",
  last_login_at: "2026-08-31T08:00:00.000Z",
  last_login_method: "password",
  password_updated_at: "2026-08-01T08:00:00.000Z",
  created_at: "2026-08-01T08:00:00.000Z",
  updated_at: "2026-08-31T08:00:00.000Z",
} as const;

describe("authentication response contracts", () => {
  it("accepts the authentication projection without profile-only fields", () => {
    expect(authUserSchema.parse(authUser)).toEqual(authUser);
    expect(initializeSystemResultSchema.parse({ user: authUser })).toEqual({
      user: authUser,
    });
  });

  it("keeps profile-only fields out of the authentication projection", () => {
    expect(
      authUserSchema.safeParse({
        ...authUser,
        registration_source: "organization_invitation",
      }).success,
    ).toBe(false);
  });

  it("requires the complete cookie-backed session response", () => {
    const session = {
      access_token: "a".repeat(48),
      access_token_expires_at: "2026-09-01T10:00:00.000Z",
      refresh_session_expires_at: "2026-11-30T08:00:00.000Z",
      user: authUser,
    };

    expect(authSessionSchema.parse(session)).toEqual(session);
    expect(
      authSessionSchema.safeParse({
        access_token: session.access_token,
        user: authUser,
      }).success,
    ).toBe(false);
  });
});
