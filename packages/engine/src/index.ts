/**
 * @ingot/engine — the deterministic distillation core.
 *
 * Contract:
 *   - Pure. No filesystem, no network, no clock, no randomness.
 *   - No DOM, browser or extension APIs. The package must stay runnable in any
 *     JS host, which is what lets the same code run in the extension, in the
 *     panel, and in CI. `test/purity.test.ts` enforces this.
 *   - Deterministic. `distill(x)` returns a structurally identical document on
 *     every run, and `serializeTokens` turns it into identical bytes.
 *
 * Typical use:
 * ```ts
 * const tokens = distill(JSON.parse(await readFile('fixtures/linear-dark/set.json', 'utf8')))
 * await writeFile('tokens.json', serializeTokens(tokens))
 * await writeFile('design.md', renderDesignMarkdown(tokens))
 * ```
 */
export { distill, serializeTokens } from './distill'
export { renderDesignMarkdown } from './export/design-md'

export { validateCaptureRecord, validateCaptureSet, CaptureValidationError } from './capture/validate'
export { CAPTURE_SCHEMA_VERSION, COMPONENT_TYPES } from './capture/types'
export type { CaptureRecord, CaptureSet, CapturedStyles, ComponentType } from './capture/types'

export { TOKENS_SCHEMA_VERSION } from './tokens/types'
export type {
  ColorRoleName,
  ColorToken,
  ColorTokens,
  ColorValue,
  BorderTokens,
  ContrastAdjustment,
  ContrastPair,
  Diagnostic,
  DiagnosticLevel,
  RadiusStepName,
  RadiusTokens,
  ShadowLayer,
  ShadowStepName,
  ShadowTokens,
  ShadowValue,
  SpacingStep,
  SpacingTokens,
  Token,
  TokensDocument,
  TypeStep,
  TypeStepName,
  TypographyTokens,
} from './tokens/types'

export type {
  Contribution,
  Derivation,
  DecisionStrategy,
  DominantChoice,
  ObservedValue,
  Provenance,
} from './provenance'

export { ENGINE_NAME, ENGINE_VERSION } from './version'

// Individual stages, exported so the future panel can re-run one decision
// (e.g. "what if the base unit were 8px?") without re-running the whole engine.
export { CONTRAST_FLOOR, enforceContrast } from './color/contrast'
export { CLUSTER_RADIUS, clusterColors, readColors } from './color/cluster'
export { NEUTRAL_CHROMA_MAX, assignRoles, detectMode } from './color/roles'
export { BASE_FIT_THRESHOLD, CANDIDATE_BASES, SNAPPING_RULE, baseFit, chooseBase, snapSpacing } from './spacing/spacing'
export { parseShadow } from './shadow/shadow'
export { colorDistance, contrastRatio, formatOklch, oklchToHex, parseColor } from './color/space'
export type { Oklch } from './color/space'
export type { ColorCluster, ColorChannel, ColorObservation } from './color/cluster'
export type { Mode, RoleAssignment } from './color/roles'
