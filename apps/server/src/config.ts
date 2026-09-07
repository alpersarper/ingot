/**
 * Server configuration, resolved once from the environment.
 *
 * Every value has a working default so `pnpm dev` and `docker compose up` both
 * run with no setup. The two secrets -- the pairing token and the LLM API key --
 * may be supplied here, but neither has to be: both can be established at first
 * run instead, which is what the panel's first-run screen is for.
 */
import { resolve } from 'node:path'

export interface ServerConfig {
  port: number
  host: string
  /** Directory holding the SQLite file and the screenshot tree. The volume. */
  dataDir: string
  /** Absolute path of the SQLite database file. */
  databaseFile: string
  /** Absolute path of the screenshot root. Only paths to files here reach the DB. */
  screenshotDir: string
  /**
   * Directory of the built panel, served statically so the container exposes
   * one port. Absent in dev, where Vite serves the panel on its own port.
   */
  panelDir: string | undefined
  /**
   * Browser origins allowed to call the API cross-origin. The panel's own
   * origin is always allowed without being listed, because in the container the
   * panel is served from this very server.
   */
  allowedOrigins: string[]
  /** Pairing token from the environment; otherwise one is generated at first run. */
  pairingToken: string | undefined
  /** LLM API key from the environment; otherwise it arrives via settings. */
  llmApiKey: string | undefined
}

function intFromEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key]
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`${key} must be a port number, received ${JSON.stringify(raw)}`)
  }
  return parsed
}

function listFromEnv(env: NodeJS.ProcessEnv, key: string): string[] {
  const raw = env[key]
  if (raw === undefined) return []
  return raw
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter((origin) => origin !== '')
}

function optional(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const raw = env[key]
  return raw === undefined || raw.trim() === '' ? undefined : raw.trim()
}

/** The Vite dev server, allowed by default so `pnpm dev` needs no configuration. */
const DEV_PANEL_ORIGIN = 'http://localhost:5173'

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const dataDir = resolve(env['INGOT_DATA_DIR'] ?? './data')
  const configured = listFromEnv(env, 'INGOT_PANEL_ORIGIN')
  const panelDir = optional(env, 'INGOT_PANEL_DIR')

  return {
    port: intFromEnv(env, 'INGOT_PORT', 4310),
    host: env['INGOT_HOST'] ?? '0.0.0.0',
    dataDir,
    databaseFile: resolve(dataDir, 'ingot.db'),
    screenshotDir: resolve(dataDir, 'screenshots'),
    panelDir: panelDir === undefined ? undefined : resolve(panelDir),
    // Without an explicit list, allow only the dev panel. Any other page that
    // wants in has to be named, which is the point of locking CORS down.
    allowedOrigins: configured.length > 0 ? configured : [DEV_PANEL_ORIGIN],
    pairingToken: optional(env, 'INGOT_PAIRING_TOKEN'),
    llmApiKey: optional(env, 'INGOT_LLM_API_KEY'),
  }
}
