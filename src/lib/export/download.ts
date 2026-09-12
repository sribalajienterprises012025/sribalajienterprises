/**
 * Hands a generated file to the browser.
 *
 * The object URL is revoked on the next tick rather than immediately: Safari
 * cancels the download if the URL is released before it has started reading.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Turns a label into something safe for a filename on every OS. */
export function safeFilename(parts: Array<string | null | undefined>): string {
  return parts
    .filter(Boolean)
    .join('-')
    .replace(/[^a-zA-Z0-9-_.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}
