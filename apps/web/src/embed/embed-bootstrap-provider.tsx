import { useCallback, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"

import { bootstrapSchema } from "@/api/contracts"
import { BootstrapContext } from "@/app/bootstrap-state"
import { embedPublicRequest } from "./session-client"

export function EmbedBootstrapProvider({ children }: { children: ReactNode }) {
  const query = useQuery({
    queryKey: ["embed", "system", "bootstrap"],
    queryFn: ({ signal }) =>
      embedPublicRequest("/api/v1/system/bootstrap", bootstrapSchema, {
        signal,
      }),
    staleTime: 0,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    retry: 1,
  })
  const { refetch } = query
  const refresh = useCallback(() => {
    void refetch()
  }, [refetch])

  return (
    <BootstrapContext.Provider
      value={{
        bootstrap: query.data,
        isLoading: query.isLoading,
        error: query.error,
        refetch: refresh,
      }}
    >
      {children}
    </BootstrapContext.Provider>
  )
}
