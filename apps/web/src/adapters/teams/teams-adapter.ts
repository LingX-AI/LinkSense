export type TeamsHostContext =
  | { kind: "web" }
  | { kind: "teams"; locale?: string; loginHint?: string }
  | { kind: "teams_error" }

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("TEAMS_SDK_TIMEOUT")),
      timeoutMs,
    )
    void promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        window.clearTimeout(timer)
        reject(error instanceof Error ? error : new Error("TEAMS_SDK_FAILED"))
      },
    )
  })
}

function isEmbeddedWindow() {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}

export async function detectTeamsHost(options?: {
  assumeEmbedded?: boolean
}): Promise<TeamsHostContext> {
  const embedded = options?.assumeEmbedded ?? isEmbeddedWindow()
  try {
    const teams = await import("@microsoft/teams-js")
    await withTimeout(teams.app.initialize(), 1_500)
    const context = await withTimeout(teams.app.getContext(), 1_500)
    return {
      kind: "teams",
      locale: context.app.locale,
      loginHint: context.user?.loginHint,
    }
  } catch {
    return embedded ? { kind: "teams_error" } : { kind: "web" }
  }
}

export async function getTeamsSsoToken() {
  const teams = await import("@microsoft/teams-js")
  return withTimeout(teams.authentication.getAuthToken(), 10_000)
}
