import { buildIdSchema, SERVER_BUILD_HEADER } from "@linksense/shared"
import { buildApiUrl } from "@/api/client"
import { clientUpdateUrl, readPublishedWebBuild } from "./client-build"

export async function reloadClientPage(
  navigate: (url: string) => void = (url) => window.location.replace(url)
): Promise<void> {
  const signal = AbortSignal.timeout(10_000)
  const [webBuild, response] = await Promise.all([
    readPublishedWebBuild(signal),
    fetch(buildApiUrl("/system/health/live"), { cache: "no-store", signal }),
  ])
  const apiBuild = buildIdSchema.safeParse(
    response.headers.get(SERVER_BUILD_HEADER)
  )
  if (!response.ok || !apiBuild.success || apiBuild.data !== webBuild) {
    throw new Error("UPDATE_NOT_READY")
  }
  navigate(clientUpdateUrl(window.location.href, webBuild))
}
