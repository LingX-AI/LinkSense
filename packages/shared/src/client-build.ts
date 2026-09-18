import { z } from "zod";

export const CLIENT_BUILD_HEADER = "x-linksense-client-build";
export const SERVER_BUILD_HEADER = "x-linksense-build";
export const buildIdSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const buildInfoSchema = z.strictObject({ build_id: buildIdSchema });
export type BuildInfo = z.infer<typeof buildInfoSchema>;
