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
