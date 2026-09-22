import { useMutation, useQuery } from "@tanstack/react-query"
import {
  socialProvidersSchema,
  socialStartSchema,
  type SocialProvider,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"

export const socialKeys = {
  providers: ["social-auth", "providers"] as const,
  settings: ["admin", "social-authentication-settings"] as const,
  accounts: ["me", "social-accounts"] as const,
}
export function useSocialProviders() {
  return useQuery({
    queryKey: socialKeys.providers,
    queryFn: () =>
      apiRequest("/auth/social/providers", {
        schema: socialProvidersSchema,
        skipRefresh: true,
      }),
  })
}
export function useSocialStart(link = false) {
  return useMutation({
    mutationFn: (provider: SocialProvider) =>
      apiRequest(`/auth/social/${provider}/${link ? "link" : "start"}`, {
        method: "POST",
        schema: socialStartSchema,
        skipRefresh: !link,
      }),
    onSuccess: ({ authorization_url }) => {
      window.location.assign(authorization_url)
    },
  })
}
