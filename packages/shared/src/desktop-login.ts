import { z } from "zod";

export const desktopLoginRedirectUri = "linksense-desktop://auth/callback";
export const desktopLoginChallengeSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);

export const desktopLoginAuthorizeInputSchema = z.strictObject({
  redirect_uri: z.literal(desktopLoginRedirectUri),
  state: desktopLoginChallengeSchema,
  code_challenge: desktopLoginChallengeSchema,
  code_challenge_method: z.literal("S256"),
});

export const desktopLoginCodeSchema = z.strictObject({ code: desktopLoginChallengeSchema });

export const desktopLoginExchangeInputSchema = z.strictObject({
  code: desktopLoginChallengeSchema,
  code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/u),
  redirect_uri: z.literal(desktopLoginRedirectUri),
});

export type DesktopLoginAuthorizeInput = z.infer<typeof desktopLoginAuthorizeInputSchema>;
export type DesktopLoginExchangeInput = z.infer<typeof desktopLoginExchangeInputSchema>;
