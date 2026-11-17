import { describe, expect, it } from "vitest";
import {
  desktopLoginAuthorizeInputSchema,
  desktopLoginExchangeInputSchema,
  desktopLoginRedirectUri,
} from "../src/desktop-login.js";

describe("native browser login contracts", () => {
  it("accepts only the app's OS-registered callback and no alternative receivers", () => {
    const input = {
      redirect_uri: desktopLoginRedirectUri,
      state: "s".repeat(43), code_challenge: "c".repeat(43), code_challenge_method: "S256",
    };
    expect(desktopLoginAuthorizeInputSchema.safeParse(input).success).toBe(true);
    for (const value of [
      "http://127.0.0.1:49152/desktop/callback", "https://evil.example/desktop/callback",
      "linksense-desktop://auth/other", "linksense-desktop://auth/callback?",
      "linksense-desktop://auth/callback#", "linksense-desktop://auth@evil.example/callback",
    ]) {
      expect(desktopLoginAuthorizeInputSchema.safeParse({ ...input, redirect_uri: value }).success, value).toBe(false);
      expect(desktopLoginExchangeInputSchema.safeParse({
        code: "c".repeat(43), code_verifier: "v".repeat(43), redirect_uri: value,
      }).success, value).toBe(false);
    }
  });

  it("requires S256 and bounded proofs without allowing extra redirect or token fields", () => {
    const input = {
      redirect_uri: desktopLoginRedirectUri,
      state: "s".repeat(43), code_challenge: "c".repeat(43), code_challenge_method: "S256",
    };
    expect(desktopLoginAuthorizeInputSchema.safeParse(input).success).toBe(true);
    for (const mutation of [
      { code_challenge_method: "plain" }, { code_challenge: "short" }, { state: "x".repeat(10000) },
      { redirect_to: "https://evil.example" }, { access_token: "secret" },
    ]) expect(desktopLoginAuthorizeInputSchema.safeParse({ ...input, ...mutation }).success).toBe(false);
    expect(desktopLoginExchangeInputSchema.safeParse({
      code: "c".repeat(43), code_verifier: "v".repeat(43), redirect_uri: input.redirect_uri,
    }).success).toBe(true);
    expect(desktopLoginExchangeInputSchema.safeParse({
      code: "c".repeat(43), code_verifier: "v".repeat(129), redirect_uri: input.redirect_uri,
    }).success).toBe(false);
  });
});
