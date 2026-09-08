/**
 * Redaction: the one thing between a provider's error message and a log file.
 *
 * The failure this exists to prevent is specific and has happened to everyone
 * who has ever shipped an API client. A provider SDK builds an error out of the
 * request that failed, and the request carried an `x-api-key` header. The error
 * is thrown, something catches it and logs it, and the user's key is now in a
 * log file, a terminal scrollback, a support ticket screenshot, or an HTTP
 * response body. Nobody wrote the line that leaked it; the leak is the default
 * behaviour of every layer being reasonable.
 *
 * So the rule here is blunt: **nothing on the assistant path is logged or
 * returned without going through {@link redact} first**, and the secrets it is
 * given are every secret this process holds, not just the one it thinks is
 * involved. Redaction is on the way out rather than at the point of use,
 * because the point of use is exactly where it gets forgotten.
 *
 * The marker is deliberately visible. A silently stripped key reads as a
 * message that never had one, and then nobody notices when the stripping stops
 * working; `[redacted]` in a log is a thing a person can grep for and a test
 * can assert on.
 */

/** What replaces a secret. Visible on purpose -- see the file header. */
export const REDACTION_MARKER = '[redacted]'

/**
 * A fragment of a secret is still a secret.
 *
 * Providers truncate keys in their own messages ("invalid x-api-key: sk-ant-…
 * xY7q"), and a leaked suffix plus a leaked prefix is a leaked key. Anything at
 * least this long that is a slice of a secret is replaced too.
 */
const MIN_FRAGMENT = 8

/**
 * Every substring of `secret` worth hunting for, longest first.
 *
 * Deliberately only prefixes and suffixes rather than every window: those are
 * what truncation produces, and generating every window of a 100-character key
 * would be thousands of replacements per log line for no extra safety.
 */
function fragments(secret: string): string[] {
  const out: string[] = [secret]
  for (let length = secret.length - 1; length >= MIN_FRAGMENT; length -= 1) {
    out.push(secret.slice(0, length), secret.slice(secret.length - length))
  }
  return out
}

/**
 * Replace every occurrence of every secret in `text`.
 *
 * Secrets that are empty, or absurdly short, are ignored: redacting the string
 * `"a"` would turn every message into marker soup, and a one-character API key
 * is not a threat model.
 */
export function redact(text: string, secrets: readonly (string | undefined)[]): string {
  let out = text
  for (const secret of secrets) {
    if (secret === undefined || secret.length < MIN_FRAGMENT) continue
    for (const fragment of fragments(secret)) {
      if (fragment === '') continue
      out = out.split(fragment).join(REDACTION_MARKER)
    }
  }
  return out
}

/**
 * An error, flattened to a string that is safe to log or return.
 *
 * Everything is taken: message, name, and any `cause` chain, because SDK errors
 * routinely put the interesting part -- and the request that produced it -- in
 * a nested cause rather than in the top-level message. What is deliberately
 * *not* taken is the stack, which carries absolute paths from this machine.
 */
export function describeError(error: unknown, secrets: readonly (string | undefined)[]): string {
  return redact(flatten(error), secrets)
}

function flatten(error: unknown, depth = 0): string {
  if (depth > 4) return '…'
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause
    const head = error.message === '' ? error.name : error.message
    return cause === undefined || cause === null ? head : `${head}: ${flatten(cause, depth + 1)}`
  }
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error) ?? String(error)
  } catch {
    return String(error)
  }
}

/**
 * A logger that cannot print a secret.
 *
 * Every assistant code path logs through one of these rather than through
 * `console` directly, so "did this call site remember to redact" is not a
 * question anyone has to answer at a call site. The secrets are read at log
 * time rather than captured at construction, because the stored key changes
 * while the process runs and a logger holding yesterday's key would let
 * today's through.
 */
export interface RedactingLogger {
  warn(message: string, error?: unknown): void
  error(message: string, error?: unknown): void
}

export function createRedactingLogger(
  secrets: () => readonly (string | undefined)[],
  sink: ((line: string) => void) | undefined = undefined,
): RedactingLogger {
  const write0 = sink ?? ((line: string) => console.error(line))
  const write = (level: string, message: string, error?: unknown): void => {
    const held = secrets()
    const detail = error === undefined ? '' : ` ${describeError(error, held)}`
    write0(`[ingot:assistant] ${level}: ${redact(message, held)}${detail}`)
  }
  return {
    warn: (message, error) => write('warn', message, error),
    error: (message, error) => write('error', message, error),
  }
}
