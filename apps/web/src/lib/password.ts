import { z } from "zod"

export const passwordSchema = z.string().superRefine((password, context) => {
  const length = Array.from(password).length
  if (
    length < 8 ||
    length > 16 ||
    !/\p{Lu}/u.test(password) ||
    !/\p{Ll}/u.test(password) ||
    !/\p{Nd}/u.test(password) ||
    !/[\p{P}\p{S}]/u.test(password)
  ) {
    context.addIssue({ code: "custom", message: "PASSWORD_POLICY_VIOLATION" })
  }
})
