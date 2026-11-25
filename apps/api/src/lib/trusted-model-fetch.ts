import { Agent } from "undici"

const directModelAgent = new Agent()

/** A trusted model's request must stay on its configured connection. */
export const trustedModelFetch: typeof fetch = (input, init) => {
  const connection = { ...init, dispatcher: directModelAgent, redirect: "error" as const }
  return fetch(input, connection)
}
