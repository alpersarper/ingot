/**
 * Server configuration, resolved once from the environment.
 *
 * Every value has a working default so `pnpm dev` and `docker compose up` both
 * run with no setup. The secrets -- the pairing token and the two LLM keys --
 * may be supplied here, but neither has to be: both can be established at first
 * run instead, which is what the panel's first-run screen is for.
 */
import { resolve } from 'node:path'
import { DEFAULT_ASSISTANT_RATE_LIMIT, DEFAULT_ASSISTANT_RATE_WINDOW_MS } from './assistant/rate-limit'
import { CONNECTION_IDS, isConnectionId } from './assistant/connections'
import type { ConnectionId } from './assistant/connections'

/**
 * A configuration the server refuses before it opens anything.
 *
 * Its own class so both launchers can print it as the one-paragraph usage error
 * it is, rather than as a crash with a stack trace.
 */
export class ConfigError extends Error {
  readonly code = 'INGOT_CONFIG'

  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

/** One line that mints a token the way the server does: 32 random bytes, base64url. */
export const GENERATE_TOKEN_COMMAND =
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`

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
  /**
   * `INGOT_REQUEST_LOG`: one line per request on stdout. On by default.
   *
   * Because the alternative is what this server used to do, which is say
   * nothing at all. A panel that had been refusing an extension's captures for
   * days -- 401, every time -- had eight lines in `docker logs`, all of them
   * the startup banner, so "no requests arrived" and "every request was
   * rejected" looked exactly alike from outside. What is logged is method,
   * path and status; never a header, never a body, never a query *value*.
   */
  requestLog: boolean
  /** Pairing token from the environment; otherwise one is generated at first run. */
  pairingToken: string | undefined
  /**
   * `INGOT_PAIRING_TOKEN_ROTATE`: let a pinned token replace a different one the
   * data directory already stores. Without it that conflict refuses to start.
   */
  rotatePairingToken: boolean
  /**
   * Anthropic API key from the environment; otherwise it arrives via settings.
   *
   * This is the Anthropic connection's credential and nobody else's: the
   * OpenAI-compatible endpoint has its own (`llmEndpointKey`), so a key stored
   * for one connection is never transmitted by another.
   */
  llmApiKey: string | undefined
  /** Bearer token for the OpenAI-compatible endpoint, pinned in the environment. */
  llmEndpointKey: string | undefined
  /**
   * The connection the assistant uses, pinned in the environment.
   *
   * Undefined means the reviewer chooses in the panel, and an unchosen panel
   * takes whichever connection is ready -- the local Claude CLI first, because
   * it is the one that costs nothing. Pinned, it is not editable from the
   * panel, the same rule the key and the model follow. Validated at load: an
   * unknown value is a boot failure rather than a silent fallback, because a
   * deployment that meant to pin a connection and typo'd it should find out
   * immediately.
   */
  llmConnection: ConnectionId | undefined
  /**
   * Model the assistant asks, pinned in the environment.
   *
   * Undefined means the reviewer chooses in the panel, falling back to the
   * assistant's own default. Pinned, it is not editable from the panel -- the
   * same rule the key follows, so a deployment that fixes one can fix both.
   */
  llmModel: string | undefined
  /**
   * Provider endpoint, when it is not the SDK's own.
   *
   * Two uses, one *environment* setting. A hosted proxy for the Anthropic
   * connection -- an organisation that wants assistant traffic to leave through
   * something it operates points this at it and nothing else changes -- and the
   * endpoint of the OpenAI-compatible connection, where it is not optional.
   * The panel-stored endpoint is narrower on purpose: it reaches only the
   * OpenAI-compatible connection, so a URL typed for Ollama cannot follow a
   * connection switch to the Anthropic client.
   */
  llmBaseUrl: string | undefined
  /**
   * How many assistant requests this server will serve per window.
   *
   * The limit is on the server rather than in the panel because the thing it
   * guards against is a *copied* pairing token: the panel is the part that
   * would have been copied. See `src/assistant/rate-limit.ts`.
   */
  assistantRateLimit: number
  assistantRateWindowMs: number
}

function intFromEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key]
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!/^\d+$/.test(raw.trim()) || parsed < 0 || parsed > 65535) {
    throw new ConfigError(`${key} must be a port number, received ${JSON.stringify(raw)}`)
  }
  return parsed
}

/**
 * A positive integer from the environment.
 *
 * Separate from {@link intFromEnv} because that one is about ports and rejects
 * anything above 65535, which is a perfectly reasonable number of milliseconds.
 */
function countFromEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key]
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ConfigError(`${key} must be a positive integer, received ${JSON.stringify(raw)}`)
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

/**
 * The pinned connection, or a boot failure.
 *
 * Unknown values are rejected rather than ignored for the same reason a bad
 * port is: a deployment that pinned something must find out at start-up, not by
 * noticing weeks later that the panel has been choosing for itself.
 */
function connectionFromEnv(env: NodeJS.ProcessEnv): ConnectionId | undefined {
  const raw = optional(env, 'INGOT_LLM_CONNECTION')
  if (raw === undefined) return undefined
  if (!isConnectionId(raw)) {
    throw new Error(`INGOT_LLM_CONNECTION must be one of ${CONNECTION_IDS.join(', ')}, received ${JSON.stringify(raw)}`)
  }
  return raw
}

function flagFromEnv(env: NodeJS.ProcessEnv, key: string, fallback = false): boolean {
  const raw = env[key]?.trim().toLowerCase()
  if (raw === undefined || raw === '') return fallback
  if (raw === '0' || raw === 'false') return false
  if (raw === '1' || raw === 'true') return true
  throw new ConfigError(`${key} must be 1 or 0, received ${JSON.stringify(env[key])}`)
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
  const pairingToken = optional(env, 'INGOT_PAIRING_TOKEN')
  const rotatePairingToken = flagFromEnv(env, 'INGOT_PAIRING_TOKEN_ROTATE')

  // Rotation is a modifier on a pinned token, never an action by itself, and
  // nothing goes quiet: alone it is refused here, before anything is opened.
  // It does not mint a fresh token instead, because left set in a compose file
  // under `restart: unless-stopped` that would mint on every restart and unpair
  // the browser and the extension again each time.
  if (rotatePairingToken && pairingToken === undefined) {
    throw new ConfigError(
      'INGOT_PAIRING_TOKEN_ROTATE (--rotate-token) rotates to a pinned token, and none is pinned, ' +
        'so nothing was changed. Pin the new token with INGOT_PAIRING_TOKEN (--token) alongside ' +
        `it, or drop the rotate setting. To generate one: ${GENERATE_TOKEN_COMMAND}`,
    )
  }

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
    requestLog: flagFromEnv(env, 'INGOT_REQUEST_LOG', true),
    pairingToken,
    rotatePairingToken,
    llmApiKey: optional(env, 'INGOT_LLM_API_KEY'),
    llmEndpointKey: optional(env, 'INGOT_LLM_ENDPOINT_KEY'),
    llmConnection: connectionFromEnv(env),
    llmModel: optional(env, 'INGOT_LLM_MODEL'),
    llmBaseUrl: optional(env, 'INGOT_LLM_BASE_URL'),
    assistantRateLimit: countFromEnv(env, 'INGOT_ASSISTANT_RATE_LIMIT', DEFAULT_ASSISTANT_RATE_LIMIT),
    assistantRateWindowMs: countFromEnv(
      env,
      'INGOT_ASSISTANT_RATE_WINDOW_MS',
      DEFAULT_ASSISTANT_RATE_WINDOW_MS,
    ),
  }
}
