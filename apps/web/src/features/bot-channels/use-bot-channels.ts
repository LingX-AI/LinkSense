import { z } from "zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  botChannelConnectionListSchema,
  botChannelRegistrationSchema,
  botChannelLinkingSessionSchema,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
export const botChannelKeys = {
  connections: ["bot-channels", "connections"] as const,
  organization: ["bot-channels", "organization"] as const,
  registration: (id: string | null) =>
    ["bot-channels", "registration", id] as const,
}
export function useBotChannels() {
  const client = useQueryClient()
  const refresh = () =>
    client.invalidateQueries({ queryKey: botChannelKeys.connections })
  const query = useQuery({
    queryKey: botChannelKeys.connections,
    queryFn: ({ signal }) =>
      apiRequest("/bot-channels", {
        schema: botChannelConnectionListSchema,
        signal,
      }),
    refetchInterval: 5000,
  })
  const disconnect = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/bot-channels/${id}`, { method: "DELETE", schema: z.null() }),
    onSuccess: refresh,
  })
  const unlink = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/bot-channels/${id}/identity`, {
        method: "DELETE",
        schema: z.null(),
      }),
    onSuccess: refresh,
  })
  return { query, disconnect, unlink, refresh }
}
export function useDingtalkRegistration() {
  return useMutation({
    mutationFn: () =>
      apiRequest("/bot-channels/dingtalk/registration-sessions", {
        method: "POST",
        body: {},
        schema: botChannelRegistrationSchema,
      }),
    gcTime: 0,
  })
}
export function useDingtalkRegistrationStatus(id: string | null) {
  return useQuery({
    queryKey: botChannelKeys.registration(id),
    queryFn: ({ signal }) =>
      apiRequest(`/bot-channels/dingtalk/registration-sessions/${id}`, {
        schema: botChannelRegistrationSchema,
        signal,
      }),
    enabled: id !== null,
    refetchInterval: (query) =>
      query.state.data?.status === "waiting_scan" || !query.state.data
        ? 3000
        : false,
    retry: false,
    gcTime: 0,
  })
}
export function useBotChannelLinking() {
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/bot-channels/${id}/linking-sessions`, {
        method: "POST",
        schema: botChannelLinkingSessionSchema,
      }),
    gcTime: 0,
  })
}
