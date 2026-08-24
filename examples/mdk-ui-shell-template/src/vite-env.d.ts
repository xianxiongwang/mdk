/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** See `src/constants/env.ts`. `VITE_API_BASE_URL` is the deprecated alias. */
  readonly VITE_MDK_API_URL: string
  readonly VITE_API_BASE_URL: string
  readonly VITE_OAUTH_BASE_URL: string
  readonly VITE_AUTH_BYPASS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
