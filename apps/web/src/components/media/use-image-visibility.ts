import { useRef, type RefObject } from "react"
import { useInView } from "framer-motion"

export function useImageVisibility<T extends HTMLElement>(): Readonly<{
  ref: RefObject<T | null>
  visible: boolean
}> {
  const ref = useRef<T>(null)
  // The window root also accounts for clipping by nested scroll containers,
  // including the generated-image thumbnail strip. Keep loaded images mounted.
  const visible = useInView(ref, { margin: "160px 0px", once: true })
  return { ref, visible }
}
