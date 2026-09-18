import { useInfiniteQuery } from "@tanstack/react-query"
import {
  applicationCatalogPageSchema,
  type ApplicationCatalogFilter,
  type ApplicationCatalogPage,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import { applicationSchema, paginatedSchema } from "@/api/contracts"

const applicationPageSchema = paginatedSchema(applicationSchema)
export const applicationCatalogKeys = {
  list: (
    scope: "owned" | "shared",
    search: string,
    state: ApplicationCatalogFilter
  ) => ["applications", "catalog", scope, search, state] as const,
}

export function useApplicationCatalog(
  scope: "owned" | "shared",
  search: string,
  state: ApplicationCatalogFilter
) {
  return useInfiniteQuery({
    queryKey: applicationCatalogKeys.list(
      scope,
      search,
      scope === "owned" ? state : "all"
    ),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ signal, pageParam }): Promise<ApplicationCatalogPage> => {
      if (scope === "owned") {
        return apiRequest("/applications/catalog", {
          query: { search: search || undefined, state, cursor: pageParam },
          schema: applicationCatalogPageSchema,
          signal,
        })
      }
      const page = await apiRequest("/applications", {
        query: { scope, search: search || undefined },
        schema: applicationPageSchema,
        signal,
      })
      return {
        items: page.items.map((application) => ({
          type: "application",
          application,
          development: null,
        })),
        next_cursor: null,
      }
    },
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  })
}
