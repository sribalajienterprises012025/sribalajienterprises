const CONTROL_BASE =
  'w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-slate-900 ' +
  'placeholder:text-slate-400 transition-colors min-h-[44px] ' +
  'disabled:bg-slate-50 disabled:text-slate-500'

/**
 * Shared class string for inputs, selects and textareas.
 *
 * Kept out of Field.tsx so that file exports only components and stays
 * eligible for fast refresh.
 */
export function controlClass(hasError?: boolean): string {
  return [
    CONTROL_BASE,
    hasError
      ? 'border-red-400 focus:border-red-500'
      : 'border-slate-300 focus:border-brand-500',
  ].join(' ')
}
