import { useState } from 'react'
import { DEMO_USERS, currentDemoUserId, resetDemo, switchDemoUser } from './backend'

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  helper: 'Helper',
  ca: 'CA',
}

/**
 * The only thing the demo adds to the screen.
 *
 * Deliberately a strip in normal document flow rather than anything floating:
 * a floating control sits on top of whatever is beneath it, and on a phone that
 * turned out to be a real button — the pill covered "Export Excel" and swallowed
 * the tap. A strip takes its own space and can never do that.
 */
export function DemoBar() {
  const [open, setOpen] = useState(false)
  const currentId = currentDemoUserId()
  const current = DEMO_USERS.find((user) => user.id === currentId) ?? DEMO_USERS[0]

  return (
    <div className="bg-slate-900 text-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Demo
        </span>

        <label className="flex items-center gap-1.5 text-xs text-slate-300">
          Signed in as
          <select
            value={current.id}
            onChange={(event) => switchDemoUser(event.target.value)}
            aria-label="Signed in as"
            className="min-h-[28px] rounded-md border border-slate-700 bg-slate-800 px-1.5 text-xs text-white"
          >
            {DEMO_USERS.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} · {ROLE_LABEL[user.role] ?? user.role}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="ml-auto text-xs text-slate-300 underline decoration-slate-600 underline-offset-2"
        >
          {open ? 'Hide' : 'What is this?'}
        </button>
      </div>

      {open && (
        <div className="mx-auto max-w-5xl space-y-2 px-4 pb-3 text-xs leading-relaxed text-slate-300">
          <p>
            This is the real app running on sample data held in this browser. Add, edit
            and delete freely — the dashboard, the ledgers and the reports all
            recalculate, and nothing here touches your live records.
          </p>
          <p>
            Change the role above to see the permission rules: a{' '}
            <strong className="font-semibold text-white">helper</strong> gets trips,
            expenses and invoices but no reports or settings, and a{' '}
            <strong className="font-semibold text-white">CA</strong> reads and exports
            everything without being able to save a change. Those are the same rules
            Postgres enforces in production, not a mock-up of them.
          </p>
          <p>
            One thing this preview cannot do: the frame it runs in blocks file
            downloads, so Export PDF, Export Excel and the CA pack will do nothing here.
            They are built and tested, and work on the live site.
          </p>
          <button
            type="button"
            onClick={() => {
              resetDemo()
              window.location.reload()
            }}
            className="min-h-[32px] rounded-md border border-slate-700 px-2.5 text-xs text-white"
          >
            Reset the sample data
          </button>
        </div>
      )}
    </div>
  )
}
