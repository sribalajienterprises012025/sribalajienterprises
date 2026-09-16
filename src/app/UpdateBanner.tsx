import { useEffect, useState } from 'react'
import { onUpdateReady } from './updates'

/**
 * Offers a new version rather than imposing one.
 *
 * A strip in normal document flow, not a floating bar: anything that floats
 * covers a control, and on a phone that control is a button somebody taps.
 */
export function UpdateBanner() {
  const [apply, setApply] = useState<(() => void) | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => onUpdateReady((next) => setApply(() => next)), [])

  if (!apply || dismissed) return null

  return (
    <div className="bg-brand-900 text-white">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2">
        <p className="text-xs">A new version of the app is ready.</p>
        <button
          type="button"
          onClick={apply}
          className="ml-auto min-h-[32px] rounded-md bg-white px-3 text-xs font-medium text-brand-900"
        >
          Update
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="min-h-[32px] px-1 text-xs text-white/70"
        >
          Later
        </button>
      </div>
    </div>
  )
}
