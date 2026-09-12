/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/**
 * Declared explicitly rather than relying on the index signature Vite provides,
 * so a typo in a variable name is a compile error instead of `undefined` at
 * runtime — which would show the setup screen with no clue why.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  /** New-style browser key: `sb_publishable_…`. Preferred. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  /** Legacy browser key on older projects: a JWT, `eyJ…`. Still accepted. */
  readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
