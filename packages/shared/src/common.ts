import { z } from "zod";

export const uuidSchema = z.string().uuid();
export const timestampSchema = z.string().datetime({ offset: true });
export const nonEmptyTextSchema = z.string().trim().min(1);

export const supportedLocales = [
  "zh-CN",
  "en-US",
  "es-ES",
  "pt-BR",
  "fr-FR",
  "ja-JP",
] as const;

export const localeSchema = z.enum(supportedLocales);
export type Locale = z.infer<typeof localeSchema>;

export function isLocale(value: unknown): value is Locale {
  return localeSchema.safeParse(value).success;
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const jsonObjectSchema = z.record(z.string(), jsonValueSchema);

export function uniqueArraySchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.array(itemSchema).superRefine((items, context) => {
    const uniqueItems = new Set(items.map((item) => JSON.stringify(item)));
    if (uniqueItems.size !== items.length) {
      context.addIssue({
        code: "custom",
        message: "array_must_contain_unique_items",
      });
    }
  });
}
