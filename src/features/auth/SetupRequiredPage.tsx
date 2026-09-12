/**
 * Shown when the app has no usable Supabase credentials.
 *
 * Without this the app would fail on its first query with a network error that
 * says nothing about the actual cause — and this is the first thing anyone hits
 * on a fresh clone or a misconfigured deploy.
 */
export function SetupRequiredPage({
  reason = 'missing',
}: {
  reason?: 'missing' | 'secret-key'
}) {
  if (reason === 'secret-key') {
    return (
      <Frame title="That is the wrong Supabase key" tone="danger">
        <p className="mt-2 text-sm text-slate-600">
          The configured key starts with{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">sb_secret_</code>. That
          is the secret key: it bypasses every row-level security policy, so anyone who
          opened this page could read and change all of your data. The app will not start
          with it.
        </p>
        <p className="mt-3 text-sm text-slate-600">
          Replace it with the <strong>publishable</strong> key from Project Settings → API
          Keys — it begins with{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">sb_publishable_</code>.
        </p>
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          If the secret key has already been deployed or committed, roll it in Project
          Settings → API Keys. Treat it as exposed.
        </p>
      </Frame>
    )
  }

  return (
    <Frame title="Supabase is not configured" tone="neutral">
      <p className="mt-2 text-sm text-slate-600">
        The app needs a Supabase project URL and publishable key before it can load any
        data.
      </p>

      <ol className="mt-5 space-y-3 text-sm text-slate-600">
        <Step n={1}>
          Create a project at supabase.com, then apply the migrations in{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
            supabase/migrations
          </code>{' '}
          with <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">supabase db push</code>.
        </Step>
        <Step n={2}>
          Copy <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">.env.example</code>{' '}
          to <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">.env.local</code> and
          fill in the project URL and the publishable key.
        </Step>
        <Step n={3}>Restart the dev server so Vite picks up the new variables.</Step>
      </ol>

      <p className="mt-5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
        In production these are set in Cloudflare Pages → Settings → Environment
        variables, never committed to the repository. Set them for Preview as well as
        Production, or branch previews land on this screen.
      </p>
    </Frame>
  )
}

function Frame({
  title,
  tone,
  children,
}: {
  title: string
  tone: 'neutral' | 'danger'
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1
          className={[
            'text-lg font-semibold',
            tone === 'danger' ? 'text-red-700' : 'text-slate-900',
          ].join(' ')}
        >
          {title}
        </h1>
        {children}
      </div>
    </div>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
        {n}
      </span>
      <span>{children}</span>
    </li>
  )
}
