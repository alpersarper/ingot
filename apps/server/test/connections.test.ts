/**
 * The three connections: choosing one, and the two new ways of reaching a model.
 *
 * The suite is in four parts, and they are deliberately at different levels.
 *
 * **Readiness** is pure arithmetic over facts the server already has, so it is
 * tested as arithmetic. It is the part the panel, the service and the error
 * messages all read from, and a wrong answer here is a button that cannot work.
 *
 * **The CLI client** is tested against a scripted command runner rather than
 * the real binary, because the thing that has to be right is *reading what the
 * CLI writes* -- including the case that motivates the whole design, where it
 * exits 0 having set `is_error: true`. The stdout in these tests is copied from
 * real runs of `claude 2.1.236`. One test at the end does run the real binary,
 * and skips itself unless `INGOT_LIVE_CLI=1` asks for it, so CI never depends
 * on a developer's login.
 *
 * **The OpenAI-compatible client** is tested against a scripted `fetch`. Same
 * reasoning: the request body and the error taxonomy are the parts a second
 * endpoint will break, not the socket.
 *
 * **The API** is tested through the real app, so that "what the panel is told"
 * and "what the assistant would actually do" are asserted against one another
 * rather than separately.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  claudeBinary,
  createClaudeCliClient,
  probeClaudeCli,
  renderPrompt,
  spawnRunner,
} from '../src/assistant/claude-cli'
import type { CliProbe, CommandResult, CommandRunner } from '../src/assistant/claude-cli'
import { connectionReports, modelFor, resolveConnection } from '../src/assistant/connections'
import type { ConnectionFacts } from '../src/assistant/connections'
import { completionsUrl, createOpenAiCompatibleClient, isUsableBaseUrl } from '../src/assistant/openai-compatible'
import { LlmError } from '../src/assistant/llm'
import type { LlmRequest } from '../src/assistant/llm'
import { detectRuntime } from '../src/assistant/runtime'
import { createHarness, body, put } from './harness'
import type { Harness } from './harness'

/* ------------------------------------------------------------- readiness -- */

const BARE: ConnectionFacts = {
  hasApiKey: false,
  baseUrl: undefined,
  model: '',
  cli: { available: false, signedIn: undefined, detail: 'not found' },
  containerized: false,
}

const CLI_READY: ConnectionFacts['cli'] = { available: true, signedIn: true, detail: '2.1.236 and signed in' }

function reportFor(id: string, facts: ConnectionFacts): ReturnType<typeof connectionReports>[number] {
  const found = connectionReports(facts).find((entry) => entry.id === id)
  if (found === undefined) throw new Error(`no connection ${id}`)
  return found
}

describe('which connections are ready', () => {
  it('takes the signed-in local CLI first, so a machine with Claude Code needs no setup', () => {
    const facts: ConnectionFacts = { ...BARE, cli: CLI_READY }
    expect(resolveConnection(facts)).toBe('claude-cli')
    expect(reportFor('claude-cli', facts).ready).toBe(true)
  })

  it('will not resolve to the CLI when it is installed but signed out, and says what to run', () => {
    const facts: ConnectionFacts = { ...BARE, cli: { available: true, signedIn: false, detail: '2.1.236' } }
    expect(reportFor('claude-cli', facts).ready).toBe(false)
    expect(reportFor('claude-cli', facts).blocked).toContain('claude auth login')
    expect(resolveConnection(facts)).toBe('anthropic-api')
  })

  it('treats "could not tell" as usable, because a probe that failed must not disable a working setup', () => {
    const facts: ConnectionFacts = { ...BARE, cli: { available: true, signedIn: undefined, detail: '1.0.0' } }
    expect(reportFor('claude-cli', facts).ready).toBe(true)
  })

  it('marks the CLI unreachable in a container rather than hiding it, and explains the local run', () => {
    const facts: ConnectionFacts = { ...BARE, cli: CLI_READY, containerized: true }
    const report = reportFor('claude-cli', facts)
    expect(report.unreachable).toBe(true)
    expect(report.ready).toBe(false)
    expect(report.blocked).toContain('container')
    expect(report.blocked).toContain('pnpm dev')
    // Still in the list: a connection a person cannot use here is information,
    // not noise, and silently dropping it reads as "Ingot does not have that".
    expect(connectionReports(facts).map((entry) => entry.id)).toContain('claude-cli')
  })

  it('needs both an endpoint and a model before the OpenAI-compatible connection is ready', () => {
    const noUrl: ConnectionFacts = { ...BARE, model: 'llama3.2' }
    expect(reportFor('openai-compatible', noUrl).ready).toBe(false)
    expect(reportFor('openai-compatible', noUrl).blocked).toContain('11434')

    const noModel: ConnectionFacts = { ...BARE, baseUrl: 'http://localhost:11434/v1' }
    expect(reportFor('openai-compatible', noModel).ready).toBe(false)
    expect(reportFor('openai-compatible', noModel).blocked).toContain('model')

    const both: ConnectionFacts = { ...BARE, baseUrl: 'http://localhost:11434/v1', model: 'llama3.2' }
    expect(reportFor('openai-compatible', both).ready).toBe(true)
    expect(resolveConnection(both)).toBe('openai-compatible')
  })

  it('falls back to the Anthropic key, which is the connection whose setup is written out', () => {
    expect(resolveConnection(BARE)).toBe('anthropic-api')
    expect(reportFor('anthropic-api', BARE).ready).toBe(false)
    expect(reportFor('anthropic-api', { ...BARE, hasApiKey: true }).ready).toBe(true)
  })

  it('gives each connection its own default model, and none to an endpoint it cannot guess for', () => {
    expect(modelFor('claude-cli', undefined)).toBe('claude-sonnet-5')
    expect(modelFor('anthropic-api', undefined)).toBe('claude-sonnet-5')
    expect(modelFor('openai-compatible', undefined)).toBe('')
    expect(modelFor('openai-compatible', '  llama3.2  ')).toBe('llama3.2')
  })

  it('reads the container declaration the image sets, and calls a bare machine a bare machine', () => {
    expect(detectRuntime({ INGOT_IN_CONTAINER: '1' }).containerized).toBe(true)
    expect(detectRuntime({ INGOT_IN_CONTAINER: 'false' }).containerized).toBe(false)
  })
})

/* ------------------------------------------------------------ the CLI ----- */

/** A successful envelope, shaped as `claude 2.1.236` actually writes it. */
function cliSuccess(structured: unknown): string {
  return JSON.stringify({
    is_error: false,
    subtype: 'success',
    num_turns: 2,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, cache_creation_input_tokens: 8012, cache_read_input_tokens: 0, output_tokens: 165 },
    modelUsage: { 'claude-sonnet-5': { inputTokens: 10, outputTokens: 165 } },
    result: JSON.stringify(structured),
    structured_output: structured,
    api_error_status: null,
    type: 'result',
  })
}

/** A failed envelope. The CLI exits 0 and reports the failure in the JSON. */
function cliFailure(status: number | null, message: string): string {
  return JSON.stringify({
    is_error: true,
    subtype: 'success',
    terminal_reason: 'api_error',
    usage: {},
    modelUsage: {},
    api_error_status: status,
    result: message,
    type: 'result',
  })
}

interface Invocation {
  command: string
  args: string[]
  stdin: string | undefined
}

function runnerReturning(result: Partial<CommandResult>, seen: Invocation[] = []): CommandRunner {
  return async (command, args, options) => {
    seen.push({ command, args: [...args], stdin: options.stdin })
    return { code: 0, stdout: '', stderr: '', timedOut: false, ...result }
  }
}

const ASK: LlmRequest<{ answer: string }> = {
  system: 'You are the review assistant.',
  messages: [{ role: 'user', content: 'Here is the kit.' }],
  schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] },
  parse: (value) => value as { answer: string },
  maxTokens: 600,
}

describe('the local Claude CLI as a provider', () => {
  it('sends the prompt on stdin and the rest in argv, with no shell and no tools', async () => {
    const seen: Invocation[] = []
    const client = createClaudeCliClient(
      { connection: 'claude-cli', model: 'claude-sonnet-5' },
      { run: runnerReturning({ stdout: cliSuccess({ answer: 'the radius is 8' }) }, seen), binary: 'claude' },
    )

    const reply = await client.complete(ASK)
    expect(reply.value.answer).toBe('the radius is 8')

    const call = seen[0]
    if (call === undefined) throw new Error('the client never ran anything')
    // The prompt -- the only unbounded thing here -- never touches argv.
    expect(call.stdin).toBe('Here is the kit.')
    expect(call.args.join(' ')).not.toContain('Here is the kit.')
    expect(call.args).toContain('--print')
    expect(call.args).toEqual(expect.arrayContaining(['--output-format', 'json']))
    expect(call.args).toEqual(expect.arrayContaining(['--model', 'claude-sonnet-5']))
    expect(call.args).toEqual(expect.arrayContaining(['--system-prompt', 'You are the review assistant.']))
    expect(call.args).toEqual(expect.arrayContaining(['--json-schema', JSON.stringify(ASK.schema)]))
    // No tools means one turn, which is what keeps a headless run from becoming
    // an agent loop on the user's machine.
    expect(call.args).toEqual(expect.arrayContaining(['--tools', '']))
    expect(call.args).toContain('--strict-mcp-config')
    expect(call.args).toContain('--no-session-persistence')
  })

  it('reports the tokens the call actually cost, cache included', async () => {
    const client = createClaudeCliClient(
      { connection: 'claude-cli', model: 'claude-sonnet-5' },
      { run: runnerReturning({ stdout: cliSuccess({ answer: 'x' }) }), binary: 'claude' },
    )
    const reply = await client.complete(ASK)
    // 10 fresh + 8012 written to cache. Reporting only the 10 would understate
    // a cached call by three orders of magnitude.
    expect(reply.usage.inputTokens).toBe(8022)
    expect(reply.usage.outputTokens).toBe(165)
    expect(reply.model).toBe('claude-sonnet-5')
  })

  it('attributes the answer to the model that did the work, not the housekeeping one', async () => {
    // A headless run bills a few tokens of Haiku against its own bookkeeping
    // whatever model was asked for, and lists it first. Reporting that one
    // would write the wrong provenance onto every proposal the call produced.
    const stdout = JSON.stringify({
      is_error: false,
      usage: { input_tokens: 5, output_tokens: 50 },
      modelUsage: {
        'claude-haiku-4-5-20251001': { inputTokens: 899, outputTokens: 13 },
        'claude-sonnet-5': { inputTokens: 764, outputTokens: 53 },
      },
      structured_output: { answer: 'sonnet answered' },
    })
    const client = createClaudeCliClient(
      { connection: 'claude-cli', model: 'claude-sonnet-5' },
      { run: runnerReturning({ stdout }), binary: 'claude' },
    )
    expect((await client.complete(ASK)).model).toBe('claude-sonnet-5')

    // And when the configured name is an alias the CLI resolved, the entry that
    // produced the most output is the one that did the work.
    const aliased = createClaudeCliClient(
      { connection: 'claude-cli', model: 'sonnet' },
      { run: runnerReturning({ stdout }), binary: 'claude' },
    )
    expect((await aliased.complete(ASK)).model).toBe('claude-sonnet-5')
  })

  it('falls back to the text result when the CLI produced no structured output', async () => {
    const stdout = JSON.stringify({ is_error: false, result: '{"answer":"from text"}', usage: {}, modelUsage: {} })
    const client = createClaudeCliClient(
      { connection: 'claude-cli', model: 'claude-sonnet-5' },
      { run: runnerReturning({ stdout }), binary: 'claude' },
    )
    expect((await client.complete(ASK)).value.answer).toBe('from text')
  })

  it('reads a failure out of the JSON even though the process exited 0', async () => {
    const client = createClaudeCliClient(
      { connection: 'claude-cli', model: 'nonexistent-model' },
      {
        run: runnerReturning({ code: 0, stdout: cliFailure(404, "There's an issue with the selected model.") }),
        binary: 'claude',
      },
    )
    await expect(client.complete(ASK)).rejects.toMatchObject({ kind: 'invalid-request', status: 404 })
  })

  it('turns a 401 into something to do rather than a status', async () => {
    const client = createClaudeCliClient(
      { connection: 'claude-cli', model: 'claude-sonnet-5' },
      { run: runnerReturning({ stdout: cliFailure(401, 'Unauthorized') }), binary: 'claude' },
    )
    await expect(client.complete(ASK)).rejects.toThrow(/claude auth login/)
  })

  it('calls a subscription limit a rate limit, and says nothing is being billed', async () => {
    const client = createClaudeCliClient(
      { connection: 'claude-cli', model: 'claude-sonnet-5' },
      { run: runnerReturning({ stdout: cliFailure(429, 'Usage limit reached') }), binary: 'claude' },
    )
    const error = await client.complete(ASK).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(LlmError)
    expect((error as LlmError).kind).toBe('rate-limit')
    expect((error as LlmError).message).toContain('nothing here is billed per call')
  })

  it('reports stderr when stdout was not JSON at all', async () => {
    const client = createClaudeCliClient(
      { connection: 'claude-cli', model: 'claude-sonnet-5' },
      { run: runnerReturning({ code: 1, stdout: 'not json', stderr: 'boom' }), binary: 'claude' },
    )
    await expect(client.complete(ASK)).rejects.toMatchObject({ kind: 'unavailable' })
    await expect(client.complete(ASK)).rejects.toThrow(/boom/)
  })

  it('tells the user how to install it when the binary is not there', async () => {
    const missing: CommandRunner = () => {
      const error = new Error('spawn claude ENOENT') as Error & { code: string }
      error.code = 'ENOENT'
      return Promise.reject(error)
    }
    const client = createClaudeCliClient({ connection: 'claude-cli', model: 'claude-sonnet-5' }, { run: missing })
    const error = await client.complete(ASK).catch((cause: unknown) => cause)
    expect((error as LlmError).kind).toBe('auth')
    expect((error as LlmError).message).toContain('INGOT_CLAUDE_CLI_PATH')
  })

  it('reports a kill as unavailable rather than as an unparseable answer', async () => {
    const client = createClaudeCliClient(
      { connection: 'claude-cli', model: 'claude-sonnet-5' },
      { run: runnerReturning({ code: null, stdout: '', timedOut: true }), binary: 'claude' },
    )
    await expect(client.complete(ASK)).rejects.toThrow(/did not answer within/)
  })

  it('renders one user message as itself and a conversation as labelled turns', () => {
    expect(renderPrompt([{ role: 'user', content: 'just this' }])).toBe('just this')
    expect(
      renderPrompt([
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
      ]),
    ).toBe('User: a\n\nAssistant: b')
  })
})

describe('probing the local CLI', () => {
  it('reports the version and the sign-in, and never the account it belongs to', async () => {
    const run: CommandRunner = async (_command, args) =>
      args[0] === '--version'
        ? { code: 0, stdout: '2.1.236 (Claude Code)\n', stderr: '', timedOut: false }
        : {
            code: 0,
            stdout: JSON.stringify({
              loggedIn: true,
              authMethod: 'claude.ai',
              subscriptionType: 'max',
              email: 'someone@example.com',
              orgId: 'org_123',
            }),
            stderr: '',
            timedOut: false,
          }

    const probe = await probeClaudeCli(run, 'claude')
    expect(probe.available).toBe(true)
    expect(probe.signedIn).toBe(true)
    expect(probe.detail).toContain('2.1.236')
    expect(probe.detail).toContain('max')
    // The account is none of the panel's business, and a field never read is a
    // field that cannot end up in a log line.
    expect(probe.detail).not.toContain('someone@example.com')
    expect(probe.detail).not.toContain('org_123')
  })

  it('says the binary is missing rather than throwing', async () => {
    const run: CommandRunner = () => {
      const error = new Error('spawn claude ENOENT') as Error & { code: string }
      error.code = 'ENOENT'
      return Promise.reject(error)
    }
    const probe = await probeClaudeCli(run, 'claude')
    expect(probe.available).toBe(false)
    expect(probe.detail).toContain('PATH')
  })

  it('leaves sign-in unknown when the CLI is too old to be asked', async () => {
    const run: CommandRunner = async (_command, args) =>
      args[0] === '--version'
        ? { code: 0, stdout: '1.0.0\n', stderr: '', timedOut: false }
        : { code: 1, stdout: '', stderr: 'unknown command', timedOut: false }
    const probe = await probeClaudeCli(run, 'claude')
    expect(probe.available).toBe(true)
    // Unknown, which readiness treats as usable. Not `false`, which would
    // disable a connection that works.
    expect(probe.signedIn).toBeUndefined()
  })

  it('takes the binary from the environment when one is pinned', () => {
    expect(claudeBinary({})).toBe('claude')
    expect(claudeBinary({ INGOT_CLAUDE_CLI_PATH: '/opt/homebrew/bin/claude' })).toBe('/opt/homebrew/bin/claude')
  })
})

/**
 * The one test that runs the real thing.
 *
 * Skipped unless `INGOT_LIVE_CLI=1`, because it needs Claude Code installed and
 * signed in, and a suite that depends on a developer's login is a suite that
 * fails in CI for reasons nobody can act on. It exists because everything above
 * it asserts against stdout that *this* test is how we know is real.
 */
describe.skipIf(process.env['INGOT_LIVE_CLI'] !== '1')('the local CLI, for real', () => {
  it('answers a structured question through the actual binary', async () => {
    const probe = await probeClaudeCli(spawnRunner)
    expect(probe.available, probe.detail).toBe(true)

    const client = createClaudeCliClient({
      connection: 'claude-cli',
      model: process.env['INGOT_LIVE_CLI_MODEL'] ?? 'claude-haiku-4-5-20251001',
      timeoutMs: 120_000,
    })
    const reply = await client.complete({
      system: 'You answer strictly in the requested JSON shape.',
      messages: [{ role: 'user', content: 'Name the colour of a clear midday sky in one word.' }],
      schema: {
        type: 'object',
        properties: { colour: { type: 'string' } },
        required: ['colour'],
        additionalProperties: false,
      },
      parse: (value) => value as { colour: string },
      maxTokens: 200,
    })
    expect(typeof reply.value.colour).toBe('string')
    expect(reply.value.colour.length).toBeGreaterThan(0)
  }, 180_000)
})

/* --------------------------------------------- the OpenAI-compatible one -- */

function completion(content: string, extra: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      model: 'llama3.2',
      choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 120, completion_tokens: 30 },
      ...extra,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

describe('an OpenAI-compatible endpoint as a provider', () => {
  it('accepts the three spellings of an endpoint people actually paste', () => {
    expect(completionsUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1/chat/completions')
    // A bare origin is what the Ollama readme prints.
    expect(completionsUrl('http://localhost:11434')).toBe('http://localhost:11434/v1/chat/completions')
    expect(completionsUrl('https://openrouter.ai/api/v1/chat/completions')).toBe(
      'https://openrouter.ai/api/v1/chat/completions',
    )
    expect(completionsUrl('https://api.groq.com/openai/v1/')).toBe('https://api.groq.com/openai/v1/chat/completions')
    expect(isUsableBaseUrl('ftp://nope')).toBe(false)
    expect(isUsableBaseUrl('')).toBe(false)
  })

  it('asks for the schema in the body and again in the prompt, and sends no key when there is none', async () => {
    let seen: { url: string; init: RequestInit } | undefined
    const client = createOpenAiCompatibleClient(
      { connection: 'openai-compatible', model: 'llama3.2', baseUrl: 'http://localhost:11434/v1' },
      {
        fetchImpl: async (url, init) => {
          seen = { url: String(url), init: init ?? {} }
          return completion('{"answer":"eight"}')
        },
      },
    )

    const reply = await client.complete(ASK)
    expect(reply.value.answer).toBe('eight')
    expect(reply.usage).toEqual({ inputTokens: 120, outputTokens: 30 })

    if (seen === undefined) throw new Error('the client never fetched anything')
    expect(seen.url).toBe('http://localhost:11434/v1/chat/completions')
    const sent = JSON.parse(String(seen.init.body)) as {
      response_format: { json_schema: { schema: unknown } }
      messages: Array<{ role: string; content: string }>
      temperature: number
    }
    expect(sent.response_format.json_schema.schema).toEqual(ASK.schema)
    // Belt and braces: an endpoint that ignores `response_format` still reads
    // the schema, because a small local model behind one routinely does.
    expect(sent.messages[0]?.content).toContain('JSON Schema')
    expect(sent.temperature).toBe(0)
    // A model on this machine has nobody to authenticate to, and an empty
    // bearer header is a 401 waiting to happen.
    expect(JSON.stringify(seen.init.headers)).not.toContain('authorization')
  })

  it('sends the key as a bearer token when there is one', async () => {
    let headers = ''
    const client = createOpenAiCompatibleClient(
      {
        connection: 'openai-compatible',
        model: 'openai/gpt-oss-120b',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-or-v1-TESTKEYTESTKEYTESTKEY',
      },
      {
        fetchImpl: async (_url, init) => {
          headers = JSON.stringify(init?.headers)
          return completion('{"answer":"ok"}')
        },
      },
    )
    await client.complete(ASK)
    expect(headers).toContain('Bearer sk-or-v1-TESTKEYTESTKEYTESTKEY')
  })

  it('reads a content list as well as a content string, so one gateway is not special', async () => {
    const payload = new Response(
      JSON.stringify({
        model: 'gemini-2.0-flash',
        choices: [{ message: { content: [{ type: 'text', text: '{"answer":' }, { type: 'text', text: '"split"}' }] } }],
        usage: {},
      }),
      { status: 200 },
    )
    const client = createOpenAiCompatibleClient(
      { connection: 'openai-compatible', model: 'gemini-2.0-flash', baseUrl: 'https://example.test/v1' },
      { fetchImpl: async () => payload },
    )
    expect((await client.complete(ASK)).value.answer).toBe('split')
  })

  it('classifies the statuses a person has a different next step for', async () => {
    const cases: Array<[number, string]> = [
      [401, 'auth'],
      [402, 'auth'],
      [404, 'invalid-request'],
      [429, 'rate-limit'],
      [400, 'invalid-request'],
      [503, 'unavailable'],
    ]
    for (const [status, kind] of cases) {
      const client = createOpenAiCompatibleClient(
        { connection: 'openai-compatible', model: 'llama3.2', baseUrl: 'http://localhost:11434/v1' },
        { fetchImpl: async () => new Response('{"error":"nope"}', { status }) },
      )
      const error = await client.complete(ASK).catch((cause: unknown) => cause)
      expect((error as LlmError).kind, `status ${String(status)}`).toBe(kind)
    }
  })

  it('names the address when nothing answers, because that is what the user has to fix', async () => {
    const client = createOpenAiCompatibleClient(
      { connection: 'openai-compatible', model: 'llama3.2', baseUrl: 'http://localhost:11434/v1' },
      {
        fetchImpl: () => Promise.reject(new Error('fetch failed: ECONNREFUSED')),
      },
    )
    await expect(client.complete(ASK)).rejects.toThrow(/could not reach the endpoint at http:\/\/localhost:11434/)
  })

  it('treats an error object returned with a 200 as an error', async () => {
    const client = createOpenAiCompatibleClient(
      { connection: 'openai-compatible', model: 'llama3.2', baseUrl: 'http://localhost:11434/v1' },
      { fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'model not loaded' } }), { status: 200 }) },
    )
    await expect(client.complete(ASK)).rejects.toThrow(/model not loaded/)
  })

  it('refuses before spending anything when no endpoint is configured', async () => {
    const client = createOpenAiCompatibleClient(
      { connection: 'openai-compatible', model: 'llama3.2' },
      {
        fetchImpl: () => {
          throw new Error('should never be called')
        },
      },
    )
    await expect(client.complete(ASK)).rejects.toMatchObject({ kind: 'auth' })
  })
})

/* -------------------------------------------------------------- the API -- */

const SIGNED_IN: CliProbe = { available: true, version: '2.1.236', signedIn: true, detail: '2.1.236 and signed in' }

/**
 * Undefined until an API describe block builds one.
 *
 * The pure halves of this file need no app at all, and a top-level `afterEach`
 * that assumed one would fail every one of them on teardown.
 */
let harness: Harness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

interface StatusBody {
  assistant: {
    configured: boolean
    connection: string
    connections: Array<{ id: string; ready: boolean; unreachable: boolean; blocked: string }>
    containerized: boolean
    model: string
    baseUrl?: string
  }
}

/** The harness for the current API test, or a clear failure rather than a cast. */
function must(): Harness {
  if (harness === undefined) throw new Error('this test needs a harness')
  return harness
}

describe('the API reports and switches connections', () => {
  beforeEach(async () => {
    harness = await createHarness({ cli: SIGNED_IN })
  })

  it('is configured with no API key at all when the local CLI is signed in', async () => {
    const status = await must().json<StatusBody>('/api/assistant')
    expect(status.assistant.configured).toBe(true)
    expect(status.assistant.connection).toBe('claude-cli')
    expect(status.assistant.model).toBe('claude-sonnet-5')
    expect(status.assistant.connections.map((entry) => entry.id)).toEqual([
      'claude-cli',
      'openai-compatible',
      'anthropic-api',
    ])
  })

  it('runs a capability over the chosen connection, and tells the provider which one it is', async () => {
    const set = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../../../fixtures/ghost-warm/set.json', import.meta.url), 'utf8'),
    )
    await must().call('/api/captures/import', body(JSON.parse(set) as unknown))
    await must().call('/api/kits', body({ groupId: null }))

    must().llm.reply({ proposals: [] })
    const response = await must().call('/api/assistant/suggest', body({ capability: 'derive' }))
    expect(response.status).toBe(200)
    // The connection reaches the provider seam, so a client built for the wrong
    // one is a visible fact rather than a silent misroute.
    expect(must().llm.configs[0]?.connection).toBe('claude-cli')
    // And no key was invented to get there.
    expect(must().llm.configs[0]?.apiKey).toBeUndefined()
  })

  it('switches to a chosen connection and back to "whichever is ready"', async () => {
    await must().call('/api/settings', put({ llmConnection: 'anthropic-api' }))
    expect((await must().json<StatusBody>('/api/assistant')).assistant.connection).toBe('anthropic-api')
    // Chosen but not ready: there is no key, so the panel still shows setup.
    expect((await must().json<StatusBody>('/api/assistant')).assistant.configured).toBe(false)

    await must().call('/api/settings', put({ llmConnection: null }))
    expect((await must().json<StatusBody>('/api/assistant')).assistant.connection).toBe('claude-cli')
  })

  it('refuses a connection it does not have, and an endpoint that is not a URL', async () => {
    const bad = await must().call('/api/settings', put({ llmConnection: 'gpt-please' }))
    expect(bad.status).toBe(400)
    const badUrl = await must().call('/api/settings', put({ llmBaseUrl: 'not a url' }))
    expect(badUrl.status).toBe(400)
    const scheme = await must().call('/api/settings', put({ llmBaseUrl: 'file:///etc/passwd' }))
    expect(scheme.status).toBe(400)
  })

  it('stores an endpoint and reports it back, because a typo has to be visible', async () => {
    await must().call('/api/settings', put({ llmBaseUrl: 'http://localhost:11434/v1/' }))
    const status = await must().json<StatusBody>('/api/assistant')
    // Stored without the trailing slash, so the endpoint this builds is stable.
    expect(status.assistant.baseUrl).toBe('http://localhost:11434/v1')
  })

  it('refuses an assistant call on a connection that is not ready, naming what to do', async () => {
    await must().call('/api/settings', put({ llmConnection: 'openai-compatible' }))
    const set = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../../../fixtures/ghost-warm/set.json', import.meta.url), 'utf8'),
    )
    await must().call('/api/captures/import', body(JSON.parse(set) as unknown))
    await must().call('/api/kits', body({ groupId: null }))

    const response = await must().call('/api/assistant/suggest', body({ capability: 'derive' }))
    // 409, as every other not-set-up case is: a 401 would log the user out of
    // their own panel.
    expect(response.status).toBe(409)
    const message = (await response.json() as { error: { message: string } }).error.message
    expect(message).toContain('11434')
    expect(message).toContain('every other feature')
    // Nothing was spent finding that out.
    expect(must().llm.calls).toHaveLength(0)
  })

  it('redacts a stored key from an error raised on a connection that has no key', async () => {
    // The failure this guards: the CLI connection holds no key, so a client
    // that redacted only "its own" secret would print the Anthropic key
    // somebody left in settings straight into the server log.
    const key = 'sk-ant-api03-LEFTBEHINDLEFTBEHINDLEFTBEHIND'
    await must().call('/api/settings', put({ llmApiKey: key }))
    const set = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../../../fixtures/ghost-warm/set.json', import.meta.url), 'utf8'),
    )
    await must().call('/api/captures/import', body(JSON.parse(set) as unknown))
    await must().call('/api/kits', body({ groupId: null }))

    must().llm.fail(new Error(`the CLI died holding ${key}`))
    const response = await must().call('/api/assistant/suggest', body({ capability: 'derive' }))

    // Still the CLI connection, and still no key handed to it.
    expect(must().llm.configs[0]?.connection).toBe('claude-cli')
    expect(must().llm.configs[0]?.apiKey).toBeUndefined()

    const text = await response.text()
    expect(text).not.toContain(key)
    expect(text).toContain('[redacted]')
    expect(must().logs.join('\n')).not.toContain(key)
    expect(must().logs.join('\n')).toContain('[redacted]')
  })
})

describe('a pinned connection', () => {
  beforeEach(async () => {
    harness = await createHarness({ cli: SIGNED_IN, env: { INGOT_LLM_CONNECTION: 'anthropic-api' } })
  })

  it('cannot be changed from the panel', async () => {
    const status = await must().json<StatusBody & { assistant: { connectionManagedByEnvironment: boolean } }>(
      '/api/assistant',
    )
    expect(status.assistant.connection).toBe('anthropic-api')
    expect(status.assistant.connectionManagedByEnvironment).toBe(true)
    expect((await must().call('/api/settings', put({ llmConnection: 'claude-cli' }))).status).toBe(409)
  })
})

describe('the container is honest about what it cannot reach', () => {
  beforeEach(async () => {
    harness = await createHarness({ cli: SIGNED_IN, containerized: true })
  })

  it('disables the CLI connection with an explanation and never resolves to it', async () => {
    const status = await must().json<StatusBody>('/api/assistant')
    expect(status.assistant.containerized).toBe(true)
    const cli = status.assistant.connections.find((entry) => entry.id === 'claude-cli')
    expect(cli?.unreachable).toBe(true)
    expect(cli?.blocked).toContain('container')
    expect(status.assistant.connection).toBe('anthropic-api')
  })

  it('refuses it even when somebody sets it deliberately', async () => {
    await must().call('/api/settings', put({ llmConnection: 'claude-cli' }))
    const set = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../../../fixtures/ghost-warm/set.json', import.meta.url), 'utf8'),
    )
    await must().call('/api/captures/import', body(JSON.parse(set) as unknown))
    await must().call('/api/kits', body({ groupId: null }))

    const response = await must().call('/api/assistant/suggest', body({ capability: 'derive' }))
    expect(response.status).toBe(409)
    expect((await response.json() as { error: { message: string } }).error.message).toContain('container')
  })
})
