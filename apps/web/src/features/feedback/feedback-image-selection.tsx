import { useEffect, useState } from "react"
import { FileImageIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"

export function FeedbackImageSelection({
  image,
  disabled,
  removeLabel,
  onRemove,
}: {
  image: { id: number; file: File }
  disabled: boolean
  removeLabel: string
  onRemove: () => void
}) {
  const [source, setSource] = useState<string | null>(null)

  useEffect(() => {
    if (typeof URL.createObjectURL !== "function") return
    const objectUrl = URL.createObjectURL(image.file)
    let active = true
    queueMicrotask(() => {
      if (active) setSource(objectUrl)
    })
    return () => {
      active = false
      URL.revokeObjectURL(objectUrl)
    }
  }, [image.file])

  return (
    <li className="relative aspect-square min-w-0 overflow-hidden rounded-xl border border-divider bg-muted">
      {source ? (
        <img
          src={source}
          alt={image.file.name}
          width="96"
          height="96"
          className="size-full object-contain"
        />
      ) : (
        <span className="flex size-full items-center justify-center text-muted-foreground">
          <FileImageIcon aria-hidden="true" />
        </span>
      )}
      <Button
        type="button"
        variant="secondary"
        size="icon-sm"
        className="absolute top-1 right-1"
        disabled={disabled}
        aria-label={removeLabel}
        onClick={onRemove}
      >
        <Trash2Icon />
      </Button>
    </li>
  )
}
