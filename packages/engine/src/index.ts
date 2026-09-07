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
export { renderComponentMarkdown } from './export/component-md'
export {
  COMPONENT_DOC_IDS,
  componentDoc,
  componentDocs,
  docRoles,
  hoverSurfaceOf,
} from './export/component-doc'
export type { ComponentDoc, ComponentDocId, DocColorRow, DocTokenRow, DocVariant } from './export/component-doc'

// Overrides: the reviewer's answer replacing the engine's. Pure and
// deterministic like the rest of the engine, so the panel can preview an
// override and the server can replay it and both get the same document.
export {
  applyOverrides,
  canonicalOverrideValue,
  hasOverrides,
  originOf,
  overriddenSlots,
  overrideRejection,
  readTokenValue,
  recipeByName,
  roleHex,
  standingConflict,
  supersededBy,
  tokenSlots,
} from './tokens/overrides'
export type {
  AppliedOverride,
  ConvergedOverride,
  OverrideConflict,
  OverrideGroup,
  OverrideKind,
  OverrideResult,
  RejectedOverride,
  TokenOrigin,
  TokenOverride,
  TokenSlot,
} from './tokens/overrides'

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
  ComponentColors,
  ComponentRecipe,
  ComponentRecipeName,
  ComponentTokens,
  ContrastAdjustment,
  ContrastPair,
  Diagnostic,
  DiagnosticLevel,
  FocusRingTokens,
  RadiusStepName,
  RadiusTokens,
  ShadowLayer,
  ShadowStepName,
  ShadowTokens,
  ShadowValue,
  SpacingBand,
  SpacingStep,
  SpacingTokens,
  StateTokens,
  Token,
  TokensDocument,
  TypeStep,
  TypeStepName,
  TypographyTokens,
} from './tokens/types'

export { derive, sanction, userOverride } from './provenance'
export type {
  Contribution,
  Derivation,
  DecisionStrategy,
  DominantChoice,
  ObservedValue,
  Provenance,
  ResolvedConflict,
} from './provenance'

export { ENGINE_NAME, ENGINE_VERSION } from './version'

// Individual stages, exported so the future panel can re-run one decision
// (e.g. "what if the base unit were 8px?") without re-running the whole engine.
export {
  CONTRAST_FLOOR,
  DISABLED_CONTRAST_FLOOR,
  enforceContrast,
  enforceContrastByChroma,
  enforceContrastOnBackground,
} from './color/contrast'
export { CLUSTER_RADIUS, clusterColors, readColors } from './color/cluster'
export { NEUTRAL_CHROMA_MAX, assignRoles, deriveInteractionShades, detectMode } from './color/roles'
export {
  BASE_FIT_THRESHOLD,
  CANDIDATE_BASES,
  LAYOUT_TARGETS_PX,
  SNAPPING_RULE,
  baseFit,
  chooseBase,
  layoutRuleFor,
  snapSpacing,
} from './spacing/spacing'
export { parseShadow } from './shadow/shadow'
export { colorDistance, contrastRatio, formatOklch, oklchToHex, parseColor } from './color/space'
export type { Oklch } from './color/space'
export type { ColorCluster, ColorChannel, ColorObservation } from './color/cluster'
export type { Mode, RoleAssignment } from './color/roles'
