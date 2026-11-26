import {
  desktopFileRootListSchema,
  desktopFileRootPatchSchema,
  desktopFileRootSchema,
  type DesktopFileRootPatch,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"

export function listDesktopFileRoots(signal?: AbortSignal) {
  return apiRequest("/desktop/file-roots", {
    method: "GET",
    schema: desktopFileRootListSchema,
    ...(signal ? { signal } : {}),
  })
}

export function updateDesktopFileRoot(
  id: string,
  patch: DesktopFileRootPatch
) {
  return apiRequest(`/desktop/file-roots/${id}`, {
    method: "PATCH",
    body: desktopFileRootPatchSchema.parse(patch),
    schema: desktopFileRootSchema,
  })
}
