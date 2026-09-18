import type { ApplicationAnnotationInput } from "@linksense/shared"

export type ApplicationAnnotationSubmit = (input: {
  annotation: ApplicationAnnotationInput
  name: string
}) => Promise<void>
