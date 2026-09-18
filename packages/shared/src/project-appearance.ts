import { z } from "zod";

export const projectIconSchema = z.enum([
  "folder", "coins", "book", "graduation-cap", "pencil", "pen-tool",
  "braces", "terminal", "music", "popcorn", "brush", "palette",
  "stethoscope", "asterisk", "flower", "briefcase", "chart-column", "medal",
  "dumbbell", "notebook", "scale", "globe", "plane", "earth",
  "wrench", "paw-print", "flask", "brain", "heart", "sprout",
]);
export const projectColorSchema = z.enum([
  "default", "red", "orange", "yellow", "green", "blue", "purple", "pink",
  "teal", "cyan", "brown", "gray",
]);
export const projectAppearanceSchema = z.strictObject({
  icon: projectIconSchema,
  color: projectColorSchema,
});
export type ProjectIcon = z.infer<typeof projectIconSchema>;
export type ProjectColor = z.infer<typeof projectColorSchema>;
export type ProjectAppearance = z.infer<typeof projectAppearanceSchema>;
