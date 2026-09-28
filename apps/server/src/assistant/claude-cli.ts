/**
 * The local Claude Code CLI, as an {@link LlmClient}.
 *
 * This is the connection that costs nothing. The `claude` binary on the user's
 * machine is already signed into their account, and a headless run of it
 * (`claude -p --output-format json`) is a single-shot completion with
 * structured output -- which is exactly the shape of the seam. So the assistant
 * gets a provider without an API key, without a Console account, and without
 * the sentence everybody is surprised by ("a Claude subscription does not
 * include API usage"). That sentence is still true of the *API*; it is simply
 * not a thing this connection has to say.
 *
 * Four decisions are worth reading before changing anything here.
 *
 * **The prompt goes on stdin; nothing user-shaped goes in argv.** A kit brief
 * is tens of kilobytes and `ARG_MAX` is not a thing to find out about in
 * production. Equally: `spawn` is called with an argument array and **never**
 * with `shell: true`, so there is no quoting to get wrong and no command
 * substitution to escape. Anything that looks like shell escaping being added
 * to this file is a bug being introduced.
 *
 * **The session is made as small as the CLI allows.** `--tools ""` (no tool
 * use, so a single turn, so no agentic loop on the user's machine),
 * `--strict-mcp-config` and `--setting-sources ""` (the user's MCP servers,
 * skills, hooks and project settings have no business shaping a token
 * suggestion), `--no-session-persistence` and `--disable-slash-commands`. The
 * working directory is a neutral one, so a `CLAUDE.md` in whatever directory
 * the server happened to start in cannot end up in the prompt. What reaches the
 * model is the kit brief and the versioned template, the same two things every
 * other connection sends.
 *
 * **Failure is reported out of the JSON, not out of the exit code.** The CLI
 * exits 0 having set `is_error: true` and `api_error_status: 404` when, for
 * instance, the model name is wrong. Driving off the exit code would turn every
 * one of those into "the assistant worked and said something unparseable".
 *
 * **There is no API key here, and the redaction still runs.** `structuredClient`
 * is given the secrets the service holds anyway, because an error on this path
 * can still quote a pairing token or an unrelated stored key, and redaction
 * being a property of the seam rather than of a provider is the whole reason
 * the seam is shaped the way it is.
 *
 * **The child does not inherit the server's whole environment.** This is the
 * free subscription path, and the panel says so: "No API key". The `claude`
 * CLI honours `ANTHROPIC_API_KEY` over its own login, so a developer's shell
 * with that variable exported would have every call billed to the key while
 * the label stayed the same -- a wrong label with no error, which defeats the
 * point of the connection. The server's own `INGOT_*` secrets have no business
 * in a spawned model-driven process either. So {@link cliEnvironment} removes
 * those before every spawn, probes included, and inherits everything else:
 * an allowlist was considered and rejected because a machine behind a
 * corporate proxy or a custom CA (`HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS`,
 * `XDG_CONFIG_HOME` and friends) would present as "the CLI connection is
 * broken on my machine".
 */
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import type { CliAuth } from './connections'
import { LlmError, structuredClient } from './llm'
import type { LlmClient, LlmClientConfig, LlmMessage } from './llm'

/** The binary, when `INGOT_CLAUDE_CLI_PATH` does not name one. Resolved on PATH. */
export const DEFAULT_CLAUDE_BINARY = 'claude'

/**
 * One request's ceiling.
 *
 * Four times the API client's, and measured rather than guessed: a `derive`
 * over the `linear-dark` kit -- a 36KB brief -- takes about 100s through the
 * CLI on Haiku and about 150s on Sonnet, because a headless run starts a Node
 * process, authenticates, and thinks before it answers. The API path is faster
 * for the same work; this connection trades latency for costing nothing, and
 * a ceiling that cut off a call the user was going to get is the worst of both.
 */
const DEFAULT_TIMEOUT_MS = 240_000

/** The version and auth probes. Cheap by construction -- neither reaches a model. */
const PROBE_TIMEOUT_MS = 10_000

/* ----------------------------------------------------------- environment -- */

/**
 * Whether a variable is withheld from the CLI.
 *
 * The rule is by *meaning*, so it survives the CLI growing a sibling: a
 * variable is withheld when it would change **who pays** or **where the call
 * goes** -- a credential the CLI would use instead of its login, an endpoint
 * override, a third-party provider switch -- or when it is one of this
 * server's own. Variables that select *which signed-in identity* to use
 * (`ANTHROPIC_PROFILE`, `ANTHROPIC_CONFIG_DIR`, an organisation id) are left
 * alone, as is `CLAUDE_CODE_OAUTH_TOKEN`, which is a subscription login in
 * another form rather than a key.
 */
export function isWithheldFromCli(name: string): boolean {
  if (name.startsWith('INGOT_')) return true
  if (name.startsWith('CLAUDE_CODE_USE_')) return true
  if (name === 'AWS_BEARER_TOKEN_BEDROCK') return true
  if (!name.startsWith('ANTHROPIC_')) return false
  return CLI_OVERRIDE_SUFFIXES.some((suffix) => name.endsWith(suffix))
}

/** The `ANTHROPIC_*` endings that name a credential or an endpoint. */
const CLI_OVERRIDE_SUFFIXES = ['_API_KEY', '_AUTH_TOKEN', '_BASE_URL', '_CUSTOM_HEADERS', '_UNIX_SOCKET'] as const

/** The environment a `claude` child is given: the server's, minus {@link isWithheldFromCli}. */
export function cliEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && !isWithheldFromCli(name)) child[name] = value
  }
  return child
}

/* --------------------------------------------------------- running things -- */

export interface CommandResult {
  /** `null` when the process was killed rather than exited. */
  code: number | null
  stdout: string
  stderr: string
  /** True when this server killed it for taking too long. */
  timedOut: boolean
}

/**
 * How a child process is run.
 *
 * Injected rather than imported so the whole of this file is testable without
 * spawning anything: the tests script stdout the way the CLI writes it, which
 * is the part that has to be read correctly. The default implementation is the
 * only thing in here that touches the operating system.
 */
export type CommandRunner = (
  command: string,
  args: readonly string[],
  options: { stdin?: string; timeoutMs: number; cwd?: string; env?: NodeJS.ProcessEnv },
) => Promise<CommandResult>

export const spawnRunner: CommandRunner = (command, args, options) =>
  new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, [...args], {
      // Never `shell: true`. See the file header.
      shell: false,
      cwd: options.cwd ?? tmpdir(),
      // Scrubbed here as well as by the callers, so no runner path -- probe or
      // completion, present or future -- can hand the CLI a key. See the header.
      env: cliEnvironment(options.env ?? process.env),
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      // A CLI that ignores SIGTERM must not hold a request open forever.
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref()
    }, options.timeoutMs)
    timer.unref()

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })

    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    })

    if (options.stdin !== undefined) {
      // A child that died before reading raises EPIPE here. The `close` above
      // is the real answer either way, so this is swallowed rather than
      // allowed to become an unhandled error event.
      child.stdin.on('error', () => undefined)
      child.stdin.end(options.stdin)
    } else {
      child.stdin.end()
    }
  })

/* ------------------------------------------------------------------ probe -- */

export interface CliProbe {
  /** True when the binary was found and answered `--version`. */
  available: boolean
  /** The CLI's own version string, when it gave one. */
  version: string | undefined
  /**
   * Whether the CLI is signed in, when it could be asked.
   *
   * `undefined` means the question could not be answered -- an older CLI with
   * no `auth status`, output this code did not recognise. That is deliberately
   * not the same as `false`: a probe we could not run must not disable a
   * connection that works.
   */
  signedIn: boolean | undefined
  /**
   * How it is signed in, when the CLI said and this code recognised it.
   *
   * `undefined` is "could not tell", never "not with a key". The panel states
   * this rather than asserting "no API key" on faith: a Console login is
   * billed to API credit however the connection is labelled.
   */
  auth: CliAuth | undefined
  /** One line for the panel and the log. Never carries anything identifying. */
  detail: string
}

/**
 * The CLI's `authMethod` vocabulary, reduced to the one distinction that
 * changes who pays. Anything unrecognised is left unknown rather than guessed.
 */
export function classifyCliAuth(method: string): CliAuth | undefined {
  const lowered = method.toLowerCase()
  if (lowered === 'claude.ai' || lowered === 'oauth') return 'subscription'
  if (lowered === 'console' || lowered.replace(/[-_]/g, '') === 'apikey') return 'api-key'
  return undefined
}

/** The binary this server will run, from the environment or the default. */
export function claudeBinary(env: NodeJS.ProcessEnv = process.env): string {
  const pinned = env['INGOT_CLAUDE_CLI_PATH']?.trim()
  return pinned === undefined || pinned === '' ? DEFAULT_CLAUDE_BINARY : pinned
}

/**
 * Is the CLI there, and is it signed in?
 *
 * Two cheap calls, neither of which reaches a model or costs anything: about a
 * tenth of a second for `--version` and a third for `auth status`. That is what
 * makes it affordable on the status endpoint, which the panel asks on every
 * load.
 *
 * `auth status` prints an object with the account's **email address** in it.
 * Exactly three fields are read out of it and the rest is dropped on the floor:
 * whether the CLI is signed in, how, and on what plan. The panel has no
 * business knowing whose account this is, and a field that is never read is a
 * field that cannot leak into a log line.
 */
export async function probeClaudeCli(
  run: CommandRunner = spawnRunner,
  binary: string = claudeBinary(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<CliProbe> {
  // The same environment the completion runs in, so the probe reports the auth
  // of the process that will actually answer rather than of a different one.
  const childEnv = cliEnvironment(env)
  let version: string
  try {
    const result = await run(binary, ['--version'], { timeoutMs: PROBE_TIMEOUT_MS, env: childEnv })
    if (result.code !== 0) {
      return {
        available: false,
        version: undefined,
        signedIn: undefined,
        auth: undefined,
        detail: `\`${binary} --version\` exited ${String(result.code)}`,
      }
    }
    version = result.stdout.trim().split('\n')[0] ?? ''
  } catch (error) {
    const code = (error as { code?: string }).code
    return {
      available: false,
      version: undefined,
      signedIn: undefined,
      auth: undefined,
      detail: code === 'ENOENT' ? `\`${binary}\` is not on this server’s PATH` : `\`${binary}\` could not be run`,
    }
  }

  let signedIn: boolean | undefined
  let auth: CliAuth | undefined
  let how = ''
  try {
    const result = await run(binary, ['auth', 'status'], { timeoutMs: PROBE_TIMEOUT_MS, env: childEnv })
    const parsed = JSON.parse(result.stdout) as unknown
    if (typeof parsed === 'object' && parsed !== null && typeof (parsed as { loggedIn?: unknown }).loggedIn === 'boolean') {
      const status = parsed as { loggedIn: boolean; authMethod?: unknown; subscriptionType?: unknown }
      signedIn = status.loggedIn
      const method = typeof status.authMethod === 'string' ? status.authMethod : ''
      const plan = typeof status.subscriptionType === 'string' ? status.subscriptionType : ''
      auth = signedIn && method !== '' ? classifyCliAuth(method) : undefined
      how = signedIn ? ` and signed in${method === '' ? '' : ` via ${method}`}${plan === '' ? '' : ` (${plan})`}` : ' but not signed in'
    }
  } catch {
    // An older CLI, or output that is not the object this understands. Left as
    // `undefined`: unknown, not unauthenticated.
  }

  return { available: true, version, signedIn, auth, detail: `${version}${how}` }
}

/* ----------------------------------------------------------------- client -- */

export interface ClaudeCliOptions {
  run?: CommandRunner
  binary?: string
  /** The environment to scrub and inherit from. The process's own by default. */
  env?: NodeJS.ProcessEnv
}

export function createClaudeCliClient(config: LlmClientConfig, options: ClaudeCliOptions = {}): LlmClient {
  const run = options.run ?? spawnRunner
  const binary = options.binary ?? claudeBinary()
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const env = cliEnvironment(options.env ?? process.env)

  return structuredClient({
    model: config.model,
    secrets: () => config.secrets?.() ?? [],
    classify: toLlmError,

    async transport(request) {
      const args = [
        '--print',
        '--output-format',
        'json',
        '--model',
        config.model,
        '--system-prompt',
        request.system,
        '--json-schema',
        JSON.stringify(request.schema),
        // No tools means no agentic loop: one turn, one answer. It is also why
        // this file does not need `--max-turns`, which this CLI does not have.
        '--tools',
        '',
        '--strict-mcp-config',
        '--setting-sources',
        '',
        '--disable-slash-commands',
        '--no-session-persistence',
      ]

      let result: CommandResult
      try {
        result = await run(binary, args, { stdin: renderPrompt(request.messages), timeoutMs, env })
      } catch (error) {
        if ((error as { code?: string }).code === 'ENOENT') {
          throw new LlmError(
            'auth',
            `the \`${binary}\` command was not found on this server’s PATH, so the local Claude CLI connection cannot run. Install Claude Code, or set INGOT_CLAUDE_CLI_PATH to its full path and restart the server.`,
          )
        }
        throw error
      }

      if (result.timedOut) {
        throw new LlmError('unavailable', `the local Claude CLI did not answer within ${Math.round(timeoutMs / 1000)}s`)
      }

      const envelope = readEnvelope(result, config.model)

      if (envelope.isError) {
        throw cliError(envelope, binary)
      }

      return {
        // `structured_output` is the schema-validated object when the CLI
        // produced one; `result` is the raw text otherwise. Preferring the
        // former means a model that wrapped its JSON in prose still parses,
        // and the seam's own reader still has the last word either way.
        text: envelope.structured === undefined ? envelope.result : JSON.stringify(envelope.structured),
        usage: envelope.usage,
        model: envelope.model === '' ? config.model : envelope.model,
        // The CLI has no distinct refusal signal; a declined answer arrives as
        // prose the seam's reader rejects, which is the same outcome.
        refused: false,
      }
    },
  })
}

/**
 * Many turns, one prompt.
 *
 * Every capability in this build sends exactly one user message, so this is
 * usually the identity function on its content. The labelled form exists so
 * that a future multi-turn capability degrades to something legible rather than
 * to a silently concatenated blob.
 */
export function renderPrompt(messages: readonly LlmMessage[]): string {
  const only = messages.length === 1 ? messages[0] : undefined
  if (only !== undefined && only.role === 'user') return only.content
  return messages.map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`).join('\n\n')
}

/* ---------------------------------------------------------- reading stdout -- */

interface Envelope {
  isError: boolean
  /** The CLI's own text answer, or its error sentence when `isError`. */
  result: string
  structured: unknown
  /** The upstream HTTP status the CLI saw, when it saw one. */
  status: number | undefined
  usage: { inputTokens: number; outputTokens: number }
  model: string
}

function readEnvelope(result: CommandResult, configured: string): Envelope {
  let parsed: unknown
  try {
    parsed = JSON.parse(result.stdout) as unknown
  } catch {
    // Nothing parseable on stdout. The exit code and stderr are all there is,
    // and stderr is the CLI's own diagnostics rather than model output, so it
    // is safe to repeat -- after the seam redacts it, as everything is.
    const detail = result.stderr.trim() === '' ? `it exited ${String(result.code)}` : result.stderr.trim().slice(0, 500)
    throw new LlmError('unavailable', `the local Claude CLI did not return a JSON result: ${detail}`)
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new LlmError('unavailable', 'the local Claude CLI returned something that was not a result object')
  }

  const record = parsed as Record<string, unknown>
  const usage = record['usage']
  const usageRecord = typeof usage === 'object' && usage !== null ? (usage as Record<string, unknown>) : {}

  return {
    isError: record['is_error'] === true,
    result: typeof record['result'] === 'string' ? record['result'] : '',
    structured: record['structured_output'],
    status: typeof record['api_error_status'] === 'number' ? record['api_error_status'] : undefined,
    usage: {
      // Cache reads and writes are input the model was charged for, so they are
      // counted. A caller that reports "input tokens" and omits them would be
      // understating a cached call by an order of magnitude.
      inputTokens:
        number(usageRecord['input_tokens']) +
        number(usageRecord['cache_creation_input_tokens']) +
        number(usageRecord['cache_read_input_tokens']),
      outputTokens: number(usageRecord['output_tokens']),
    },
    model: modelOf(record['modelUsage'], configured),
  }
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * The model that actually answered.
 *
 * Not simply the first key of `modelUsage`: a headless run bills a few tokens
 * of Haiku against its own housekeeping whatever model was asked for, so a run
 * of `--model claude-sonnet-5` reports *two* models and Haiku is often first.
 * Reporting that one would write the wrong provenance onto every proposal the
 * call produced. The configured model wins where it appears; otherwise the
 * entry that produced the most output is the one that did the work.
 */
function modelOf(modelUsage: unknown, configured: string): string {
  if (typeof modelUsage !== 'object' || modelUsage === null) return ''
  const entries = Object.entries(modelUsage as Record<string, unknown>)
  if (entries.length === 0) return ''
  if (entries.some(([name]) => name === configured)) return configured

  let best = ''
  let most = -1
  for (const [name, usage] of entries) {
    const output =
      typeof usage === 'object' && usage !== null ? number((usage as Record<string, unknown>)['outputTokens']) : 0
    if (output > most) {
      most = output
      best = name
    }
  }
  return best
}

/**
 * Which kind of failure the CLI reported.
 *
 * Driven by the upstream status where there is one, for the same reason the
 * Anthropic client does it that way: matching on message text is how an error
 * class stops being recognised the week somebody rewords a sentence. The
 * messages themselves are the CLI's own, which are written for a person at a
 * terminal and read perfectly well in a panel.
 *
 * None of them asserts a billing fact. This client cannot know how the CLI is
 * signed in -- a 429 on a Console-keyed CLI is a paid key's rate limit, and
 * "nothing here is billed" would be a knowably wrong label with no error. The
 * connection's summary and the panel row say what is billed, because they
 * have the probe's auth classification and this client does not.
 */
function cliError(envelope: Envelope, binary: string): LlmError {
  const detail = envelope.result === '' ? 'the CLI reported an error with no detail' : envelope.result
  const status = envelope.status

  if (status === 401 || status === 403) {
    return new LlmError(
      'auth',
      `the local Claude CLI is not authorised: ${detail}. Run \`${binary} auth login\` in a terminal on this machine.`,
      status,
    )
  }
  if (status === 429) {
    return new LlmError('rate-limit', `the local Claude CLI hit a usage limit: ${detail}`, status)
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return new LlmError('invalid-request', `the local Claude CLI refused the request: ${detail}`, status)
  }
  return status === undefined
    ? new LlmError('unavailable', `the local Claude CLI could not answer: ${detail}`)
    : new LlmError('unavailable', `the local Claude CLI could not answer: ${detail}`, status)
}

function toLlmError(error: unknown, describe: (error: unknown) => string): LlmError | undefined {
  if (error instanceof LlmError) return error
  return new LlmError('unavailable', `the local Claude CLI failed: ${describe(error)}`)
}
