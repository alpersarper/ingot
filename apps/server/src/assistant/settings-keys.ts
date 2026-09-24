/**
 * The settings keys the assistant reads.
 *
 * In their own file so that the settings route and the assistant service share
 * one spelling without either importing the other: the route stores, the
 * service reads, and neither needs to know the other exists.
 *
 * `llm.apiKey` is the secret. It is written here and read only inside
 * `service.ts`, which hands it to the provider and drops it. Nothing else in
 * this server reads that key, and no route returns it -- see
 * `src/routes/settings.ts` for the rule and `test/assistant.test.ts` for the
 * scan that holds every response to it.
 */

/** The Anthropic API key. Write-only from every direction outside the server. */
export const LLM_API_KEY_SETTING = 'llm.apiKey'

/** The model the assistant asks. Not a secret; the panel shows it. */
export const LLM_MODEL_SETTING = 'llm.model'

/**
 * Which connection the assistant uses: `claude-cli`, `openai-compatible` or
 * `anthropic-api`. Not a secret. Unset means "whichever is ready", which is how
 * a machine with the Claude CLI signed in needs no setup at all.
 */
export const LLM_CONNECTION_SETTING = 'llm.connection'

/**
 * The endpoint for the OpenAI-compatible connection.
 *
 * Not a secret, and stored beside the key rather than in it: an endpoint is a
 * thing a person needs to see and correct, and hiding it behind the key's
 * write-only rule would make a typo undiagnosable.
 */
export const LLM_BASE_URL_SETTING = 'llm.baseUrl'
