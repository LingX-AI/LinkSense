import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  applicationInstallationSetupSchema,
  applicationSchema,
  applicationSetupBindingInputSchema,
  applicationSetupRevisionSchema,
  applicationSetupModelInputSchema,
  type Application,
  type ApplicationSetupBindingInput,
  type ApplicationSetupRevision,
  type ApplicationSetupModelInput,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import { applicationDistributionKeys } from "./application-distribution-queries"

export function useApplicationSetup(
  applicationId: string,
  onCompleted: (application: Application) => void
) {
  const client = useQueryClient()
  const key = applicationDistributionKeys.setup(applicationId)
  const path = `/applications/${applicationId}/installation/setup`
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      apiRequest(path, { schema: applicationInstallationSetupSchema, signal }),
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    staleTime: 0,
  })
  const save = useMutation({
    mutationFn: (input: ApplicationSetupBindingInput) =>
      apiRequest(path, {
        method: "PATCH",
        body: applicationSetupBindingInputSchema.parse(input),
        schema: applicationInstallationSetupSchema,
      }),
    onSuccess: async (guide) => {
      client.setQueryData(key, guide)
      await client.invalidateQueries({ queryKey: ["applications"] })
    },
    onError: () => client.invalidateQueries({ queryKey: key }),
  })
  const saveModel = useMutation({
    mutationFn: (input: ApplicationSetupModelInput) =>
      apiRequest(`${path}/model`, {
        method: "PATCH",
        body: applicationSetupModelInputSchema.parse(input),
        schema: applicationInstallationSetupSchema,
      }),
    onSuccess: async (guide) => {
      client.setQueryData(key, guide)
      await client.invalidateQueries({ queryKey: ["applications"] })
    },
    onError: () => client.invalidateQueries({ queryKey: key }),
  })
  const complete = useMutation({
    mutationFn: (input: ApplicationSetupRevision) =>
      apiRequest(`${path}/complete`, {
        method: "POST",
        body: applicationSetupRevisionSchema.parse(input),
        schema: applicationSchema,
      }),
    onSuccess: async (application) => {
      await client.invalidateQueries({ queryKey: ["applications"] })
      onCompleted(application)
    },
    onError: () => client.invalidateQueries({ queryKey: key }),
  })
  return { query, save, saveModel, complete }
}
