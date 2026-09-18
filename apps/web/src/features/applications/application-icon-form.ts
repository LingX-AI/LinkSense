import type {
  ApplicationIcon,
  ApplicationIconInput,
  ApplicationIconPreset,
} from "@linksense/shared"

export type ApplicationIconFormState =
  | { mode: "preset"; preset: ApplicationIconPreset }
  | {
      mode: "existing-custom"
      icon: Extract<ApplicationIcon, { type: "custom" }>
    }
  | {
      mode: "upload"
      filename: string
      mimeType: "image/png" | "image/jpeg" | "image/webp"
      dataBase64: string
      previewUrl: string
    }

export function applicationIconInputFor(
  icon: ApplicationIconFormState
): ApplicationIconInput | undefined {
  if (icon.mode === "existing-custom") return undefined
  if (icon.mode === "preset") return { type: "preset", preset: icon.preset }
  return {
    type: "upload",
    filename: icon.filename,
    mime_type: icon.mimeType,
    data_base64: icon.dataBase64,
  }
}
