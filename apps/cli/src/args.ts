/**
 * The `ingot` command line, parsed.
 *
 * Kept separate from everything that acts on it, and kept pure: parsing a flag
 * list is the part of a CLI that is easy to get subtly wrong and easy to test,
 * so it is a function from `string[]` to a plain result rather than something
 * tangled up with `process.exit`. `apps/cli/test/args.test.ts` is written
 * against this and nothing else.
 *
 * Every flag here has an `INGOT_*` environment equivalent already documented in
 * [docs/panel.md](../../../docs/panel.md); the flag wins, the environment is the
 * fallback, and neither is required. That order is resolved in `cli.ts`, which
 * owns defaults -- this file reports only what was actually typed.
 */

/** What the user asked for, before any default is applied. */
export interface RunOptions {
  /** `--port`. Absent means "whatever the environment or the default says". */
  readonly port?: number
  /** `--host`. */
  readonly host?: string
  /** `--data-dir`: where the database, the screenshots and the token live. */
  readonly dataDir?: string
  /** `--token`: pin the pairing token instead of letting the panel mint one. */
  readonly token?: string
  /** `--rotate-token`: let `--token` replace a different token the library already stores. */
  readonly rotateToken?: true
  /** False with `--no-open`: do not launch a browser. */
  readonly open: boolean
}

export type ParsedArgs =
  | { readonly kind: 'run'; readonly options: RunOptions }
  | { readonly kind: 'help' }
  | { readonly kind: 'version' }
  | { readonly kind: 'error'; readonly message: string }

export const HELP = `
  ingot -- the design-kit distillation workbench, running locally

  Usage
    npx ingot-workbench [options]

  Options
    -p, --port <port>      Port to serve the panel on (default 4310)
        --host <host>      Address to bind (default 127.0.0.1, this machine only)
    -d, --data-dir <dir>   Library, screenshots and pairing token (default ~/.ingot)
        --token <token>    Pin the pairing token instead of minting one
        --rotate-token     Let --token replace the library's stored token; paired
                           browsers and extensions must pair again
        --no-open          Do not open a browser
    -h, --help             Print this
    -v, --version          Print the version

  The library is kept in the data directory, so it survives between runs, and
  nothing leaves this machine unless you turn the assistant on. Ctrl-C stops it.
`.slice(1)

/** A flag that takes a value, by both of its spellings. */
type ValuedFlag = 'port' | 'host' | 'dataDir' | 'token'

const VALUED = new Map<string, ValuedFlag>([
  ['--port', 'port'],
  ['-p', 'port'],
  ['--host', 'host'],
  ['--data-dir', 'dataDir'],
  ['-d', 'dataDir'],
  ['--token', 'token'],
])

function port(raw: string): number | { error: string } {
  const parsed = Number.parseInt(raw, 10)
  if (!/^\d+$/.test(raw) || !Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
    return { error: `--port must be a port number between 1 and 65535, received ${JSON.stringify(raw)}` }
  }
  return parsed
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const options: {
    port?: number
    host?: string
    dataDir?: string
    token?: string
    rotateToken?: true
    open: boolean
  } = { open: true }

  for (let index = 0; index < argv.length; index += 1) {
    // Non-null: the loop bound guarantees this one exists, but
    // `noUncheckedIndexedAccess` cannot see that.
    const argument = argv[index] as string

    if (argument === '--help' || argument === '-h') return { kind: 'help' }
    if (argument === '--version' || argument === '-v') return { kind: 'version' }
    if (argument === '--no-open') {
      options.open = false
      continue
    }
    if (argument === '--rotate-token') {
      options.rotateToken = true
      continue
    }

    // `--port=4311` and `--port 4311` are the same thing; accepting only one of
    // them is the kind of detail that turns a one-liner into a support thread.
    const split = argument.indexOf('=')
    const name = split === -1 ? argument : argument.slice(0, split)
    const inline = split === -1 ? undefined : argument.slice(split + 1)

    const field = VALUED.get(name)
    if (field === undefined) return { kind: 'error', message: `unknown option ${JSON.stringify(argument)}` }

    const value = inline ?? argv[index + 1]
    if (value === undefined || (inline === undefined && value.startsWith('-'))) {
      return { kind: 'error', message: `${name} needs a value` }
    }
    if (inline === undefined) index += 1

    if (field === 'port') {
      const parsed = port(value)
      if (typeof parsed !== 'number') return { kind: 'error', message: parsed.error }
      options.port = parsed
    } else if (value.trim() === '') {
      return { kind: 'error', message: `${name} needs a value` }
    } else {
      options[field] = value
    }
  }

  return { kind: 'run', options }
}
