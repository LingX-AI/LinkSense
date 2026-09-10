import { z } from "zod";

import { timestampSchema, uniqueArraySchema, uuidSchema } from "./common.js";

export const taskCategoryNameSchema = z.string().trim().min(1).max(80);
export const taskCategoryInputSchema = z.strictObject({
  name: taskCategoryNameSchema,
});
export const taskCategorySchema = z.strictObject({
  id: uuidSchema,
  name: taskCategoryNameSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export const taskCategoryListSchema = z.array(taskCategorySchema);
export const taskCategoryOrderSchema = z.strictObject({
  category_ids: uniqueArraySchema(uuidSchema).min(2).max(10_000),
});
export type TaskCategoryOrder = z.infer<typeof taskCategoryOrderSchema>;
export type TaskCategory = z.infer<typeof taskCategorySchema>;
export type TaskCategoryInput = z.infer<typeof taskCategoryInputSchema>;
