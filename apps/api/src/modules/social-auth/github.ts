import { z } from "zod"
import type { SocialIdentity } from "./protocol.js"

const profileSchema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  login: z.string().min(1).max(255),
  name: z.string().nullable().optional(),
})
const emailsSchema = z.array(
  z.object({
    email: z.string(),
    primary: z.boolean(),
    verified: z.boolean(),
  }),
)

export async function githubIdentity(
  clientId: string,
  accessToken: string,
): Promise<SocialIdentity> {
  const request = async (
    path: "/user" | "/user/emails?per_page=100",
  ): Promise<unknown> => {
    const response = await fetch(new URL(path, "https://api.github.com"), {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${accessToken}`,
        "user-agent": "LinkSense",
        "x-github-api-version": "2022-11-28",
      },
      signal: AbortSignal.timeout(5_000),
      redirect: "error",
    })
    if (!response.ok) throw new Error("social profile unavailable")
    return response.json()
  }
  const profile = profileSchema.parse(await request("/user"))
  // The public profile's email is not evidence of mailbox verification.
  const emails = emailsSchema.parse(
    await request("/user/emails?per_page=100"),
  )
  const verified = emails.filter(
    (entry) =>
      entry.verified && z.email().max(320).safeParse(entry.email).success,
  )
  const email = verified.find((entry) => entry.primary) ?? verified[0]
  return {
    provider: "github",
    clientId,
    subject: String(profile.id),
    email: email?.email.toLowerCase() ?? null,
    emailVerified: Boolean(email),
    name: (profile.name || profile.login).slice(0, 120),
  }
}
