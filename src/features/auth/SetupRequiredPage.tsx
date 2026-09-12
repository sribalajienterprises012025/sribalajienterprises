/**
 * Shown when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing.
 * Without this the app would fail on the first query with a network error that
 * says nothing about the actual cause.
 */
export function SetupRequiredPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Supabase is not configured</h1>
        <p className="mt-2 text-sm text-slate-600">
          The app needs a Supabase project URL and anon key before it can load any data.
        </p>

        <ol className="mt-5 space-y-3 text-sm text-slate-600">
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
              1
            </span>
            <span>
              Create a project at supabase.com, then apply the migrations in{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
                supabase/migrations
              </code>
              .
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
              2
            </span>
            <span>
              Copy{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">.env.example</code>{' '}
              to{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">.env.local</code>{' '}
              and fill in the project URL and anon key.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
              3
            </span>
            <span>Restart the dev server so Vite picks up the new variables.</span>
          </li>
        </ol>

        <p className="mt-5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          In production these are set in Cloudflare Pages → Settings → Environment
          variables, never committed to the repository.
        </p>
      </div>
    </div>
  )
}
