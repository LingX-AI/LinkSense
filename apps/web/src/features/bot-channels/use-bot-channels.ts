import { z } from "zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  botChannelConnectionListSchema,
  botChannelConnectionSchema,
  type BotChannelCreate,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"

export const botChannelKeys = {
  connections: ["bot-channels", "connections"] as const,
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
  const create = useMutation({
    mutationFn: (input: BotChannelCreate) =>
      apiRequest("/bot-channels", {
        method: "POST",
        body: input,
        schema: botChannelConnectionSchema,
      }),
    onSuccess: refresh,
  })
  const disconnect = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/bot-channels/${id}`, { method: "DELETE", schema: z.null() }),
    onSuccess: refresh,
  })
  return { query, create, disconnect }
}
