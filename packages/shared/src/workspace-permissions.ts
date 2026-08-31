export const linksenseRuntimeIdentity = {
  apiUid: 1000,
  taskUid: 1001,
  sharedGid: 1000,
} as const

export const workspacePermissionPolicy = {
  supervisorPrivateDirectory: 0o700,
  supervisorPrivateFile: 0o600,
  taskPrivateDirectory: 0o700,
  taskPrivateFile: 0o600,
  sharedDirectory: 0o2770,
  sharedReadableFile: 0o640,
  sharedWritableFile: 0o660,
  sharedExecutableFile: 0o750,
  sharedReadonlyDirectory: 0o2750,
  sharedReadonlyFile: 0o640,
} as const

export const managedProjectionProbeFileName =
  ".linksense-managed-projection-v1"
export const managedProjectionProbeContents =
  "linksense-managed-projection-v1\n"
