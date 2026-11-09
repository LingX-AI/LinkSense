import { useEffect, type ReactNode, type RefObject } from "react"

import { useImageVisibility } from "@/components/media/use-image-visibility"

export function ImageVisibilityTarget({
  id,
  onVisible,
  children,
}: Readonly<{
  id: string
  onVisible: (id: string) => void
  children: (ref: RefObject<HTMLDivElement | null>) => ReactNode
}>) {
  const { ref, visible } = useImageVisibility<HTMLDivElement>()
  useEffect(() => {
    if (visible) onVisible(id)
  }, [id, onVisible, visible])
  return children(ref)
}
