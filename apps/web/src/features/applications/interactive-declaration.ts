import {
  interactiveDependenciesSchema,
  interactiveDependencyOptionsSchema,
  interactiveDependencyTypeSchema,
  type InteractiveDependencyType,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"

export type DeclarationResource = {
  type: InteractiveDependencyType
  id: string
  name: string
}
export const declarationResourceKey = (resource: DeclarationResource): string =>
  `${resource.type}:${resource.id}`

export async function loadDeclarationResources(
  signal: AbortSignal
): Promise<DeclarationResource[]> {
  const groups = await Promise.all(
    interactiveDependencyTypeSchema.options.map(async (type) => {
      const resources: DeclarationResource[] = []
      let cursor: string | undefined
      do {
        const page = await apiRequest(
          "/applications/interactive-dependency-options",
          {
            query: { type, cursor },
            schema: interactiveDependencyOptionsSchema,
            signal,
          }
        )
        resources.push(...page.items.map((item) => ({ ...item, type })))
        cursor = page.next_cursor ?? undefined
      } while (cursor)
      return resources
    })
  )
  return groups
    .flat()
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

export function buildResourceDeclaration(
  resources: DeclarationResource[]
): ReturnType<typeof interactiveDependenciesSchema.safeParse> {
  const entries = (type: InteractiveDependencyType) =>
    resources
      .filter((item) => item.type === type)
      .map(({ id, name }) => ({ id, name }))
  return interactiveDependenciesSchema.safeParse({
    plugins: entries("plugin"),
    skills: entries("skill"),
    mcp_servers: entries("mcp_server"),
    knowledge_bases: entries("knowledge_base"),
  })
}
