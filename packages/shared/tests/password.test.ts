import { describe, expect, it } from "vitest";

import { passwordSchema } from "../src/password.js";
import {
  changePasswordInputSchema,
  localLoginInputSchema,
} from "../src/auth.js";
import { errorCatalog } from "../src/errors.js";

describe("passwordSchema", () => {
  it("accepts a password satisfying the documented Unicode policy", () => {
    expect(passwordSchema.safeParse("Password1!").success).toBe(true);
    expect(passwordSchema.safeParse("Abcdef中1！").success).toBe(true);
    expect(passwordSchema.safeParse("Aa1!xxxxxxxxxxxx").success).toBe(true);
  });

  it("counts Unicode code points instead of UTF-16 code units", () => {
    expect(passwordSchema.safeParse("Aa1!😀😀😀😀").success).toBe(true);
  });

  it("rejects values missing a required Unicode category", () => {
    expect(passwordSchema.safeParse("password1!").success).toBe(false);
    expect(passwordSchema.safeParse("PASSWORD1!").success).toBe(false);
    expect(passwordSchema.safeParse("Password!!").success).toBe(false);
    expect(passwordSchema.safeParse("Password11").success).toBe(false);
  });

  it("rejects passwords longer than 16 Unicode code points", () => {
    expect(passwordSchema.safeParse("Aa1!xxxxxxxxxxxxx").success).toBe(false);
  });

  it("uses plain-language password policy errors in both locales", () => {
    expect(errorCatalog.PASSWORD_POLICY_VIOLATION.messages).toEqual({
      "zh-CN": "密码需为 8~16 个字符，且包含大写、小写、数字和标点或符号。",
      "en-US":
        "Password must be 8–16 characters and include uppercase, lowercase, a number, and punctuation or a symbol.",
    });
  });

  it("does not trim or normalize the password", () => {
    const value = " Password1! ";
    const parsed = passwordSchema.parse(value);
    expect(parsed).toBe(value);
  });

  it("applies the policy to new passwords but not to login verification input", () => {
    expect(
      localLoginInputSchema.safeParse({
        email: "user@example.com",
        password: "legacy-password-that-is-longer-than-sixteen",
      }).success,
    ).toBe(true);
    expect(
      changePasswordInputSchema.safeParse({
        current_password: "legacy-password-that-is-longer-than-sixteen",
        new_password: "NextPass2!",
      }).success,
    ).toBe(true);
    expect(
      changePasswordInputSchema.safeParse({
        current_password: "legacy",
        new_password: "legacy",
      }).success,
    ).toBe(false);
  });
});
