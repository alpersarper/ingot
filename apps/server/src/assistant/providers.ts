/**
 * Which implementation serves which connection. The whole of the dispatch.
 *
 * It is a switch and nothing else on purpose. The seam's promise is that a
 * capability depends on {@link LlmClient} alone, and the way that promise stops
 * being true is not a dramatic violation -- it is somebody reaching for a
 * provider from a capability "just to check something". Keeping the mapping in
 * one three-armed function means there is exactly one place that knows the set,
 * so a fourth connection is a case here plus a file, and never a change to
 * anything above.
 *
 * The three arms are deliberately unlike each other, and that is the point of
 * having them:
 *
 *   - **`claude-cli`** spawns a process on this machine and uses the account it
 *     is already signed into. No key and no account to create; what a call
 *     costs is whatever that login costs (see `connections.ts`).
 *   - **`openai-compatible`** posts to an address the user named. Covers a
 *     model running on their own laptop and every hosted gateway that speaks
 *     the same body.
 *   - **`anthropic-api`** is the original: the official SDK, a prepaid key.
 *
 * `secrets` is threaded through from the service rather than derived here, so
 * every client redacts *every* secret this process holds and not merely its own
 * key -- see `LlmClientConfig.secrets`.
 */
import { createAnthropicClient } from './anthropic'
import { createClaudeCliClient } from './claude-cli'
import { createOpenAiCompatibleClient } from './openai-compatible'
import type { ClaudeCliOptions } from './claude-cli'
import type { OpenAiCompatibleOptions } from './openai-compatible'
import type { LlmClient, LlmClientConfig, LlmClientFactory } from './llm'

export interface ProviderOptions {
  cli?: ClaudeCliOptions
  openAi?: OpenAiCompatibleOptions
}

export function createLlmClient(config: LlmClientConfig, options: ProviderOptions = {}): LlmClient {
  switch (config.connection) {
    case 'claude-cli':
      return createClaudeCliClient(config, options.cli ?? {})
    case 'openai-compatible':
      return createOpenAiCompatibleClient(config, options.openAi ?? {})
    case 'anthropic-api':
      return createAnthropicClient(config)
  }
}

/** The factory the server uses when nothing else is injected. */
export const defaultLlmFactory: LlmClientFactory = (config) => createLlmClient(config)
