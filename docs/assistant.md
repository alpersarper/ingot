# Connecting the assistant

The assistant is the advisory layer in the panel's right column: it proposes
token values, drafts the reason behind an override, names the kit's palette and
answers questions about it from its own provenance. It never writes a token —
everything it produces is a card you accept or dismiss — and **every other
feature of Ingot works without it**. What it does need is a model to ask.

There are three ways to give it one, and they are listed here in the order the
panel lists them, which is the order of what they cost you:

| | What it is | What it costs | Works in Docker |
| --- | --- | --- | --- |
| **Local Claude Code CLI** | The `claude` binary on your machine, in headless mode, signed into the account you already use | Nothing beyond the subscription you have | **No** — it is a host process |
| **OpenAI-compatible endpoint** | Anything that speaks `/chat/completions`: Ollama on your laptop, OpenRouter, Groq, Gemini | Nothing for a local model; a free tier or per-token for a hosted one | Yes |
| **Anthropic API key** | The official API, from prepaid Console credit | About $0.03 a suggestion | Yes |

You do not have to choose up front. With nothing configured, the server uses
**whichever connection is ready**, checked in that same order — so if you have
Claude Code installed and signed in, the assistant simply works, and this page
is something you never had to read.

The whole of this is behind one interface (`LlmClient`), so which connection you
use changes *who answers* and nothing else: the same versioned prompts, the same
structured output, the same engine guardrails between a model's answer and a
card. See [docs/panel.md](panel.md#the-provider-seam).

---

## 1. Local Claude Code CLI — no API key

If you are reading this you very likely already have it.

```sh
npm i -g @anthropic-ai/claude-code   # if you have not
claude auth login                    # once
```

That is the whole setup. The server finds `claude` on its `PATH`, checks it is
signed in, and offers the connection. Your Claude Pro or Max subscription covers
it; nothing is billed per call, and the usage limits are the ones you already
have.

Each assistant call runs one headless completion:

```sh
claude --print --output-format json --model … --system-prompt … --json-schema … --tools ""
```

with the prompt on stdin. `--tools ""` means no tool use, which means a single
turn — this never becomes an agent loop on your machine. MCP servers, skills,
hooks, project settings and `CLAUDE.md` are all switched off for the run, and
the working directory is a neutral one, so what reaches the model is the kit
brief and Ingot's own template and nothing that happens to be lying around.

**It is slower than the API.** A `derive` over a full kit takes roughly 100
seconds on Haiku and 150 on Sonnet, because a headless run starts a process,
authenticates and thinks before it answers. That is the trade: this connection
costs nothing and takes longer. Set the model to a Haiku if you would rather
have the speed.

### Why it is not available in Docker

`docker compose up` runs the server inside a container, and a container cannot
start a process on your machine — the binary, your login and your keychain are
all on the other side of that boundary. No configuration fixes this, so the
panel shows the connection **disabled with that explanation** rather than
pretending. Use it on the local run:

```sh
pnpm dev
```

In Docker, use one of the two connections below.

### If the panel says it cannot find it

- `claude` not on the server's `PATH` — common when the server was started from
  a launcher rather than a shell. Set `INGOT_CLAUDE_CLI_PATH` to the full path
  (`which claude` will tell you) and restart.
- Installed but signed out — run `claude auth login`. The panel notices within
  thirty seconds; there is no need to restart the server.

---

## 2. An OpenAI-compatible endpoint — local, or a free tier

One connection type covers every server that speaks the OpenAI
`/chat/completions` body. Set the **endpoint URL**, the **model**, and an **API
key only if the endpoint wants one**.

### Ollama, on your own machine — nothing leaves it

```sh
ollama serve
ollama pull qwen2.5:14b
```

| | |
| --- | --- |
| Endpoint | `http://localhost:11434/v1` |
| Model | `qwen2.5:14b` |
| Key | none |

This is the only configuration in which the kit brief never leaves your machine
at all.

A small model will fail more often than a frontier one, and it fails the safe
way: the assistant asks for structured output twice — as a `response_format`
JSON Schema *and* as an instruction in the prompt — and anything that still
comes back malformed is rejected by the reader before it can become a card. You
get "the model's answer was not usable", not a wrong token value.

**From Docker**, the container's `localhost` is the container. Use
`http://host.docker.internal:11434/v1` instead; `docker-compose.yml` already
maps that name on Linux.

### OpenRouter — has a free tier

| | |
| --- | --- |
| Endpoint | `https://openrouter.ai/api/v1` |
| Model | e.g. `deepseek/deepseek-chat-v3.1:free` — see [openrouter.ai/models](https://openrouter.ai/models?max_price=0) |
| Key | from [openrouter.ai/keys](https://openrouter.ai/keys) |

### Google Gemini — has a free tier

| | |
| --- | --- |
| Endpoint | `https://generativelanguage.googleapis.com/v1beta/openai` |
| Model | e.g. `gemini-2.5-flash` |
| Key | from [aistudio.google.com](https://aistudio.google.com/apikey) |

### Groq

| | |
| --- | --- |
| Endpoint | `https://api.groq.com/openai/v1` |
| Model | e.g. `llama-3.3-70b-versatile` |
| Key | from [console.groq.com](https://console.groq.com/keys) |

The URL you paste is treated generously: a bare origin gets `/v1` added, a
versioned base gets `/chat/completions` added, and a full endpoint URL is used
as it stands. Only `http://` and `https://` are accepted.

---

## 3. An Anthropic API key

The original connection, and still the right one for a deployment that wants
assistant traffic to be an ordinary metered API call.

> **A Claude subscription does not include API usage.** Claude Pro and Max pay
> for claude.ai. The API is billed separately, from prepaid credit on an
> [Anthropic Console](https://console.anthropic.com) account. Having one does
> not give you the other. If you have Claude Code installed, connection 1 uses
> that subscription instead and costs nothing.

Sign in at <https://console.anthropic.com> (the Console, not claude.ai), add
credit under **Billing**, create a key under **API keys**, and paste it into the
Assistant tab. One suggestion costs about **$0.03** at `claude-sonnet-5`; **$5
of credit is ample** for working through a kit many times over.

---

## Configuration

Everything is settable from the panel. Anything pinned in the environment wins
and becomes read-only there, which is how a deployment fixes a choice.

| Variable | Effect |
| --- | --- |
| `INGOT_LLM_CONNECTION` | `claude-cli`, `openai-compatible` or `anthropic-api`. Unset: whichever is ready. An unknown value fails at start-up rather than silently falling back. |
| `INGOT_LLM_MODEL` | The model to ask. Unset: the connection's own default (`claude-sonnet-5` for both Claude connections; an OpenAI-compatible endpoint has no default and must be told). |
| `INGOT_LLM_BASE_URL` | The OpenAI-compatible endpoint — or a hosted proxy for the Anthropic connection. |
| `INGOT_LLM_API_KEY` | The key, for the connections that take one. |
| `INGOT_CLAUDE_CLI_PATH` | Full path to the `claude` binary, when it is not on the server's `PATH`. |
| `INGOT_IN_CONTAINER` | Set to `1` by the image. Declares that host processes are unreachable; the CLI connection is disabled and explained. |

One model setting serves every connection rather than one each. Switching
connection and forgetting to change the model gets you a 404 with the model name
in it, which explains itself; a per-connection model table would be bookkeeping
for a panel that shows one connection at a time.

## What this does not change

- **The API key is still write-only.** No endpoint returns it, from any
  connection, and it is redacted from every log and error message — including
  provider-SDK errors and truncated fragments. The endpoint URL *is* returned,
  deliberately: it is not a secret and a typo in it has to be visible.
- **A key is only ever sent where it belongs.** A stored Anthropic key is not
  quietly used as a bearer token against whatever endpoint you pointed the
  OpenAI-compatible connection at; the connection declares whether it takes a
  key, and the service passes one only where it does.
- **The assistant still never writes a token.** Every proposal, from every
  connection, goes through the engine's own `applyOverrides` before it becomes a
  card, and becomes a value only when a person accepts it.
- **Determinism is untouched.** The assistant writes nothing, so `pnpm skeleton`
  and every export are byte-identical with any connection configured or none —
  until a proposal is accepted, which is an ordinary override.
- **What leaves your machine** is the same one payload whichever connection is
  used, and with a local model it does not leave at all. The list is in the
  [README](../README.md#what-leaves-your-machine).

## Why not the Vercel AI SDK

It was evaluated for v1 and declined, and re-evaluated when the second and third
connections were added. The answer did not change.

The seam already owns everything the SDK would have been adopted for: parsing,
schema validation, the error taxonomy, and — the one that matters — redaction,
which lives above the transport so that a provider implementation cannot forget
it. What was left for each new connection was a transport: about thirty lines of
`fetch` for the OpenAI-compatible one, and a `spawn` for the CLI, which no
provider SDK models at all. Adopting the SDK would have meant a dependency, a
second retry policy, a second error taxonomy and a redaction boundary we no
longer controlled, in exchange for code we did not write. The interface was the
contract that kept this deferral bounded, and it held.
