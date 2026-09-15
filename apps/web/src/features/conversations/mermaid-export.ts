import type { MermaidDiagram } from "@/features/conversations/mermaid-renderer"

export async function exportMermaidPng(diagram: MermaidDiagram): Promise<Blob> {
  const { width, height } = diagram
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    throw new Error("Invalid diagram dimensions")
  const scale = Math.min(
    2,
    16_384 / width,
    16_384 / height,
    Math.sqrt(20_000_000 / (width * height))
  )
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.floor(width * scale))
  canvas.height = Math.max(1, Math.floor(height * scale))
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Image export unavailable")
  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      window.clearTimeout(timeout)
      image.onload = null
      image.onerror = null
      if (error) reject(error)
      else resolve()
    }
    const timeout = window.setTimeout(
      () => finish(new Error("Diagram image load timed out")),
      10_000
    )
    image.onload = () => finish()
    image.onerror = () => finish(new Error("Diagram image load failed"))
    image.src = diagram.url
  })
  context.fillStyle = diagram.background
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error("Diagram PNG encoding failed"))
    }, "image/png")
  })
}
