import { z } from "zod";

export const userEnvironmentSettingsSchema = z.strictObject({
  keep_running: z.boolean(),
});

export type UserEnvironmentSettings = z.infer<typeof userEnvironmentSettingsSchema>;
