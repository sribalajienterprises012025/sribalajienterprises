import { Component, type ErrorInfo, type ReactNode } from 'react'

/** The demo routes in the hash; production uses real paths. */
const IS_DEMO = import.meta.env.VITE_DEMO === '1'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Catches a render error and shows something instead of nothing.
 *
 * Without this, one thrown error anywhere in the tree unmounts the whole app
 * and leaves a blank white screen — no message, no way back, and nothing to
 * report beyond "it stopped working". That is the least useful failure an app
 * can have on a phone in a truck yard.
 *
 * The message is shown rather than hidden: it is the one piece of information
 * that makes the problem fixable, and there is nothing sensitive in it. The
 * data is safe either way, since everything is already saved in Postgres.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept in the console so the stack is available to anyone debugging, even
    // though the screen only shows the message.
    console.error('Unhandled error in the app:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">
            This screen stopped working
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Nothing you entered has been lost — every record is saved as it is entered.
            Going back to the dashboard usually clears it.
          </p>

          <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-500">
            {error.message || 'Unknown error'}
          </p>

          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="min-h-[44px] flex-1 rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => {
                // The tree is already broken, so a route change alone would
                // not re-render anything: this has to be a fresh load.
                if (IS_DEMO) {
                  window.location.hash = '/'
                  window.location.reload()
                } else {
                  window.location.assign('/')
                }
              }}
              className="min-h-[44px] flex-1 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white"
            >
              Dashboard
            </button>
          </div>
        </div>
      </div>
    )
  }
}
