import { useQuery } from "@tanstack/react-query"
import { systemUpdateStatusSchema } from "@linksense/shared"

import { apiRequest } from "@/api/client"
import { useAuth } from "@/app/auth-state"

export const systemUpdateQueryKey = ["admin", "system-update"] as const
const ADMIN_UPDATE_REFETCH_INTERVAL_MS = 30 * 60 * 1_000

export function useSystemUpdateStatus() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin" && user.status === "active"
  return useQuery({
    queryKey: systemUpdateQueryKey,
    queryFn: ({ signal }) =>
      apiRequest("/admin/system-update", {
        schema: systemUpdateStatusSchema,
        signal,
      }),
    enabled: isAdmin,
    staleTime: 5 * 60 * 1_000,
    refetchInterval: isAdmin ? ADMIN_UPDATE_REFETCH_INTERVAL_MS : false,
  })
}
