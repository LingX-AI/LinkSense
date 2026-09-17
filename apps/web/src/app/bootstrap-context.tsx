import { useEffect, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"

import { apiRequest } from "@/api/client"
import { bootstrapSchema } from "@/api/contracts"
import { BootstrapContext } from "@/app/bootstrap-state"
import { applyProductMetadata } from "@/app/product-branding"

export function BootstrapProvider({ children }: { children: ReactNode }) {
  const query = useQuery({
    queryKey: ["system", "bootstrap"],
    queryFn: ({ signal }) =>
      apiRequest("/system/bootstrap", {
        schema: bootstrapSchema,
        signal,
        cache: "no-store",
      }),
    staleTime: 60_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    retry: 1,
  })
  const systemName = query.data?.system_name

  useEffect(() => {
    if (systemName) applyProductMetadata(document, systemName)
  }, [systemName])

  return (
    <BootstrapContext.Provider
      value={{
        bootstrap: query.data,
        isLoading: query.isLoading,
        error: query.error,
        refetch: () => {
          void query.refetch()
        },
      }}
    >
      {children}
    </BootstrapContext.Provider>
  )
}
