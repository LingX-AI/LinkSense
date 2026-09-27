import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"

export const contributorStart = "<!-- contributors:start -->"
export const contributorEnd = "<!-- contributors:end -->"
export const readmeFiles = ["README.md", "README.zh-CN.md"]

const root = path.resolve(import.meta.dirname, "..")
const loginSchema = z.string().regex(/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/iu)
const repositorySchema = z.object({
  owner: loginSchema,
  repo: z.string().regex(/^[a-z\d_.-]{1,100}$/iu),
})
const contributorsSchema = z.array(z.discriminatedUnion("type", [
  z.object({
    type: z.literal("User"),
    login: loginSchema,
    id: z.number().int().positive(),
    contributions: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("Bot") }),
  z.object({ type: z.literal("Anonymous") }),
]))

export function normalizeContributors(input) {
  const parsed = contributorsSchema.safeParse(input)
  // Do not expose API payloads (including anonymous author details) in job logs.
  if (!parsed.success) throw new Error("Invalid GitHub contributor data; READMEs were not changed.")

  const users = parsed.data
    .filter((entry) => entry.type === "User" && entry.contributions > 0)
    .sort((left, right) => {
      const countOrder = right.contributions - left.contributions
      if (countOrder !== 0) return countOrder
      const a = left.login.toLowerCase()
      const b = right.login.toLowerCase()
      return a < b ? -1 : a > b ? 1 : 0
    })
  const seen = new Set()
  const contributors = users.filter((user) => {
    if (seen.has(user.id)) return false
    seen.add(user.id)
    return true
  })
  if (contributors.length === 0) {
    throw new Error("GitHub returned no human contributors; existing READMEs were preserved.")
  }
  return contributors
}

export function renderContributors(input) {
  const users = normalizeContributors(input)
  // Construct public GitHub URLs from validated identifiers, never API-supplied URLs.
  const avatars = users.map(({ login, id }) =>
    `  <a href="https://github.com/${login}"><img src="https://avatars.githubusercontent.com/u/${id}?s=128" width="64" height="64" alt="${login}" title="${login}" /></a>`,
  )
  return ["<p>", ...avatars, "</p>"].join("\n")
}

export function replaceContributors(source, block) {
  const start = source.indexOf(contributorStart)
  const end = source.indexOf(contributorEnd)
  if (
    source.split(contributorStart).length !== 2 ||
    source.split(contributorEnd).length !== 2 ||
    start >= end
  ) {
    throw new Error("Each README must contain exactly one ordered pair of contributor markers.")
  }
  const newline = source.includes("\r\n") ? "\r\n" : "\n"
  return source.slice(0, start + contributorStart.length) + newline +
    block.replaceAll("\n", newline) + newline + source.slice(end)
}

export async function updateContributors({ github, owner, repo, directory = root }) {
  const repository = repositorySchema.safeParse({ owner, repo })
  if (!repository.success) throw new Error("Invalid GitHub repository identity.")
  const documents = await Promise.all(readmeFiles.map(async (file) => {
    const filePath = path.join(directory, file)
    return { file, filePath, before: await readFile(filePath, "utf8") }
  }))
  // A README layout without contributor sections does not opt into avatar updates.
  if (documents.every(({ before }) => !before.includes(contributorStart) && !before.includes(contributorEnd))) {
    return []
  }
  const input = await github.paginate(github.rest.repos.listContributors, {
    ...repository.data,
    per_page: 100,
    request: { timeout: 15_000 },
  })
  const block = renderContributors(input)
  // Validate both documents before writing either; an API or marker error is not an empty list.
  const updates = documents.map((document) => ({
    ...document,
    after: replaceContributors(document.before, block),
  }))
  const changed = updates.filter(({ before, after }) => before !== after)
  for (const { filePath, after } of changed) await writeFile(filePath, after, "utf8")
  return changed.map(({ file }) => file)
}
