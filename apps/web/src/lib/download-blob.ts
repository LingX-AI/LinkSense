export function downloadUrl(url: string, filename: string) {
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.rel = "noopener"
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  downloadUrl(url, filename)
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
