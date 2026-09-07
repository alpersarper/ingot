/**
 * The three documents, and which question each one answers.
 *
 * A tokens document is one shape but three different claims, depending on what
 * has been replayed into it, and asking a question of the wrong one is a defect
 * that reads as a plausible answer:
 *
 *   - **Pristine** -- the stored distillation, no overrides. What *provenance
 *     and evidence* claims read: the captures said this, and nothing a reviewer
 *     did is in it.
 *   - **Baseline** -- pristine plus every *other* override, the one under
 *     question left out. What *conflict determination*, *now-agrees* and the
 *     redundancy check ("an override that agrees is not an override") read: it
 *     is the engine's current answer for a slot, with the reviewer's other
 *     decisions and everything they re-derived already in force.
 *   - **Effective** -- pristine plus *all* overrides. What *rendering*, the docs
 *     view and every export read: the kit as it now is.
 *
 * The distinction is a type rather than a convention because the three are
 * structurally identical, so the compiler is the only reader that can catch the
 * mix-up. The brands are mutually exclusive on purpose: a pristine document is
 * *not* silently acceptable where a baseline is wanted, even when a kit happens
 * to carry no overrides, because that is exactly how the two answers drifted
 * apart in the first place.
 *
 * There is one way to build each: {@link asPristine} at the boundary where
 * stored bytes are parsed, `baselineFor` in `./overrides`, which is the only
 * thing that knows what "every other override" means, and `applyOverrides`,
 * which produces the effective document. {@link asEffective} exists for the one
 * honest shortcut: a kit with no overrides at all, whose stored bytes already
 * are the effective document.
 */
import type { TokensDocument } from './types'

declare const documentClass: unique symbol

/** The stored distillation: what the captures said, and nothing else. */
export type PristineTokens = TokensDocument & { readonly [documentClass]: 'pristine' }

/** Pristine plus every override except the one being asked about. */
export type BaselineTokens = TokensDocument & { readonly [documentClass]: 'baseline' }

/** Pristine plus every override: the kit as it is rendered and exported. */
export type EffectiveTokens = TokensDocument & { readonly [documentClass]: 'effective' }

/**
 * Name a parsed document as the stored distillation.
 *
 * Use it where bytes written by `distill` come back in -- a kit row, a
 * committed `tokens.json` -- and nowhere else. Anything that has had an
 * override replayed into it is a different document and must not be called
 * pristine.
 */
export function asPristine(tokens: TokensDocument): PristineTokens {
  return tokens as PristineTokens
}

/**
 * Name a document as the effective one.
 *
 * Only sound when nothing was overridden, which is the case a caller takes when
 * it hands back stored bytes rather than replaying an empty override list over
 * them. With overrides, `applyOverrides` is what produces this document.
 */
export function asEffective(tokens: TokensDocument): EffectiveTokens {
  return tokens as EffectiveTokens
}
