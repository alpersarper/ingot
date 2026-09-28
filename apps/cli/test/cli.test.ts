/**
 * The launcher's two pure parts: what the user typed, and what the server is
 * told as a result.
 *
 * Nothing here starts a server. The value of testing `panelEnv` rather than a
 * running panel is that the precedence rule -- flag, then environment, then the
 * CLI's own default -- is the part that silently does the wrong thing, and it is
 * the part a manual smoke run would not notice: a run that works because the
 * default happened to match the environment looks identical to one that works
 * because the flag was honoured.
 *
 * Both modules under test are deliberately free of the server and the engine, so
 * this suite loads neither a native module nor a port. The npx path itself is
 * exercised end to end against a packed tarball, which is a release step rather
 * than a unit test; see the repository README.
 */
import { describe, expect, it } from 'vitest'
import { HELP, parseArgs } from '../src/args'
import { pairingUrl, panelEnv, panelUrl } from '../src/resolve'

const DEFAULTS = { home: '/home/someone', panelDir: '/pkg/dist/panel' }

/** The options a bare `npx ingot-workbench` produces. */
function bare(): ReturnType<typeof parseArgs> {
  return parseArgs([])
}

function options(argv: readonly string[]): Parameters<typeof panelEnv>[0] {
  const parsed = parseArgs(argv)
  if (parsed.kind !== 'run') throw new Error(`expected a run, got ${parsed.kind}`)
  return parsed.options
}

describe('parseArgs', () => {
  it('defaults to running and opening a browser', () => {
    expect(bare()).toEqual({ kind: 'run', options: { open: true } })
  })

  it('reads every long flag', () => {
    expect(options(['--port', '5000', '--host', '0.0.0.0', '--data-dir', '/kits', '--token', 'abc'])).toEqual({
      open: true,
      port: 5000,
      host: '0.0.0.0',
      dataDir: '/kits',
      token: 'abc',
    })
  })

  it('accepts `--flag=value` as well as `--flag value`', () => {
    expect(options(['--port=5000', '--data-dir=/kits'])).toMatchObject({ port: 5000, dataDir: '/kits' })
  })

  it('reads the short spellings', () => {
    expect(options(['-p', '4311', '-d', '/kits'])).toMatchObject({ port: 4311, dataDir: '/kits' })
  })

  it('reads --rotate-token', () => {
    expect(options(['--token', 'abc', '--rotate-token'])).toMatchObject({ token: 'abc', rotateToken: true })
    expect(options([]).rotateToken).toBeUndefined()
  })

  it('turns the browser off', () => {
    expect(options(['--no-open']).open).toBe(false)
  })

  it('answers help and version before anything else', () => {
    expect(parseArgs(['--port', '4311', '--help'])).toEqual({ kind: 'help' })
    expect(parseArgs(['-v'])).toEqual({ kind: 'version' })
  })

  it('rejects an unknown option rather than ignoring it', () => {
    expect(parseArgs(['--porrt', '4311'])).toEqual({
      kind: 'error',
      message: 'unknown option "--porrt"',
    })
  })

  it('rejects a port that is not one', () => {
    // A bare `--port` swallowing the next flag is the failure this guards: the
    // user would get a panel on a port they did not ask for.
    expect(parseArgs(['--port', '--no-open']).kind).toBe('error')
    expect(parseArgs(['--port', '70000']).kind).toBe('error')
    expect(parseArgs(['--port', '4310x']).kind).toBe('error')
    expect(parseArgs(['--port', '0']).kind).toBe('error')
  })

  it('rejects a value-taking flag with nothing after it', () => {
    expect(parseArgs(['--data-dir'])).toEqual({ kind: 'error', message: '--data-dir needs a value' })
    expect(parseArgs(['--token='])).toEqual({ kind: 'error', message: '--token needs a value' })
  })

  it('documents every flag it accepts', () => {
    for (const flag of ['--port', '--host', '--data-dir', '--token', '--no-open', '--help', '--version']) {
      expect(HELP).toContain(flag)
    }
  })
})

describe('panelEnv', () => {
  it('binds loopback and keeps the library in the home directory', () => {
    const env = panelEnv(options([]), {}, DEFAULTS)
    expect(env['INGOT_HOST']).toBe('127.0.0.1')
    expect(env['INGOT_DATA_DIR']).toBe('/home/someone/.ingot')
    expect(env['INGOT_PANEL_DIR']).toBe('/pkg/dist/panel')
  })

  it('leaves the port alone when no flag asked for one, so the server default applies', () => {
    expect(panelEnv(options([]), {}, DEFAULTS)['INGOT_PORT']).toBeUndefined()
  })

  it('lets a flag beat the environment', () => {
    const env = panelEnv(options(['--port', '5000', '--host', '0.0.0.0', '--data-dir', '/kits']), {
      INGOT_PORT: '9999',
      INGOT_HOST: '10.0.0.1',
      INGOT_DATA_DIR: '/elsewhere',
    }, DEFAULTS)
    expect(env['INGOT_PORT']).toBe('5000')
    expect(env['INGOT_HOST']).toBe('0.0.0.0')
    expect(env['INGOT_DATA_DIR']).toBe('/kits')
  })

  it('lets the environment beat the defaults', () => {
    const env = panelEnv(options([]), { INGOT_HOST: '10.0.0.1', INGOT_DATA_DIR: '/elsewhere' }, DEFAULTS)
    expect(env['INGOT_HOST']).toBe('10.0.0.1')
    expect(env['INGOT_DATA_DIR']).toBe('/elsewhere')
  })

  it('carries every other INGOT_ variable through untouched', () => {
    // The assistant, the rate limit and the CORS allowlist are configured the
    // same way under npx as in the container, because the CLI is not a second
    // configuration system -- see `apps/server/src/config.ts`.
    const env = panelEnv(options([]), { INGOT_LLM_API_KEY: 'sk-x', INGOT_ASSISTANT_RATE_LIMIT: '3' }, DEFAULTS)
    expect(env['INGOT_LLM_API_KEY']).toBe('sk-x')
    expect(env['INGOT_ASSISTANT_RATE_LIMIT']).toBe('3')
  })

  it('asks for rotation only when the flag was given, and otherwise leaves the environment\'s answer', () => {
    expect(panelEnv(options(['--rotate-token']), {}, DEFAULTS)['INGOT_PAIRING_TOKEN_ROTATE']).toBe('1')
    expect(panelEnv(options([]), {}, DEFAULTS)['INGOT_PAIRING_TOKEN_ROTATE']).toBeUndefined()
    expect(panelEnv(options([]), { INGOT_PAIRING_TOKEN_ROTATE: '1' }, DEFAULTS)['INGOT_PAIRING_TOKEN_ROTATE']).toBe('1')
  })

  it('pins the pairing token only when one was given', () => {
    expect(panelEnv(options([]), {}, DEFAULTS)['INGOT_PAIRING_TOKEN']).toBeUndefined()
    expect(panelEnv(options(['--token', 'abc']), {}, DEFAULTS)['INGOT_PAIRING_TOKEN']).toBe('abc')
  })
})

describe('panelUrl', () => {
  it('prints the host in effect rather than assuming localhost', () => {
    expect(panelUrl('127.0.0.1', 4310)).toBe('http://127.0.0.1:4310')
    expect(panelUrl('192.168.1.20', 4311)).toBe('http://192.168.1.20:4311')
  })

  it('brackets an IPv6 host', () => {
    expect(panelUrl('::1', 4310)).toBe('http://[::1]:4310')
  })

  it('sends a browser to loopback for a wildcard bind', () => {
    expect(panelUrl('0.0.0.0', 4310)).toBe('http://localhost:4310')
    expect(panelUrl('::', 4310)).toBe('http://localhost:4310')
  })
})

describe('pairingUrl', () => {
  it('opens the host the panel is bound to', () => {
    expect(new URL(pairingUrl('192.168.1.20', 4310, 'abc')).host).toBe('192.168.1.20:4310')
  })

  it('hands the token over in the fragment, never the query string', () => {
    const url = new URL(pairingUrl('127.0.0.1', 4310, 'tok+en/with=chars'))
    expect(url.search).toBe('')
    expect(url.hash).toBe('#token=tok%2Ben%2Fwith%3Dchars')
    expect(new URLSearchParams(url.hash.slice(1)).get('token')).toBe('tok+en/with=chars')
  })
})
