export type OfficeDocumentState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error" }>
  | Readonly<{ status: "ready"; content: Uint8Array }>

export type OfficeSelectionAnchor = Readonly<{
  left: number
  top: number
}>

export type OfficeSelectionAction<TSelection> = Readonly<{
  label: string
  shortcutLabel?: string
  disabled?: boolean
  disabledReason?: string
  promptLabel: string
  placeholder: string
  submitLabel: string
  errorMessage: string
  onSubmit: (selection: TSelection, description: string) => Promise<void>
}>

export type OfficeAnnotationMarker<TSelection> = Readonly<{
  id: string
  index: number
  selection: TSelection
}>

export type OfficeAnnotationNavigationRequest = Readonly<{
  id: string
  sequence: number
}>

/**
 * A new artifact was produced for the document currently open in the preview.
 * The shell owns the presentation so every supported document viewer gets the
 * same refresh affordance.
 */
export type OfficePreviewUpdateAction = Readonly<{
  statusLabel: string
  actionLabel: string
  dismissLabel?: string
  onUpdate: () => void
  onDismiss?: () => void
}>
