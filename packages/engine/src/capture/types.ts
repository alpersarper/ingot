/**
 * Capture record schema, version 1.
 *
 * A capture record is what the (future) browser extension emits for one
 * captured UI component: what it was, where it came from, and the computed
 * style values the browser reported for it. It is the only input the
 * distillation engine accepts.
 *
 * The normative machine-readable copy of this schema lives in
 * `schemas/capture-record.schema.json`; prose lives in `docs/capture-record.md`.
 * Keep all three in step.
 */

/** Schema version of a single capture record. Bumped on breaking changes. */
export const CAPTURE_SCHEMA_VERSION = 1

/**
 * The component taxonomy. Deliberately tiny: it is a coarse tag used to weight
 * style observations, not a component model. Do not grow it without a matching
 * schema version bump.
 */
export const COMPONENT_TYPES = ['button', 'card', 'input', 'typography'] as const
export type ComponentType = (typeof COMPONENT_TYPES)[number]

/**
 * Computed style values for one captured element.
 *
 * Keys mirror CSSOM camelCase property names and values mirror what
 * `getComputedStyle` returns: always strings, always resolved (`"14px"`, not
 * `"0.875rem"`; `"rgb(94, 106, 210)"` or `"#5e6ad2"`, not `"var(--brand)"`).
 * Every field is optional because a real capture only carries the properties
 * that were relevant to the element -- a typography capture has no border.
 */
export interface CapturedStyles {
  /** Foreground/text colour. Any CSS colour syntax. */
  color?: string
  backgroundColor?: string

  fontFamily?: string
  /** Absolute length, e.g. `"14px"`. */
  fontSize?: string
  /** Numeric weight as a string, e.g. `"500"`. Keywords are rejected. */
  fontWeight?: string
  /** `"20px"`, a unitless ratio like `"1.5"`, or `"normal"`. */
  lineHeight?: string
  /** `"-0.2px"` or `"normal"`. */
  letterSpacing?: string

  paddingTop?: string
  paddingRight?: string
  paddingBottom?: string
  paddingLeft?: string

  marginTop?: string
  marginRight?: string
  marginBottom?: string
  marginLeft?: string

  /** Flex/grid gap, when the element is a container. */
  gap?: string

  borderTopWidth?: string
  borderRightWidth?: string
  borderBottomWidth?: string
  borderLeftWidth?: string
  /** Shorthand style keyword, e.g. `"solid"` or `"none"`. */
  borderStyle?: string
  borderColor?: string

  borderTopLeftRadius?: string
  borderTopRightRadius?: string
  borderBottomRightRadius?: string
  borderBottomLeftRadius?: string

  /** `"none"` or one or more comma-separated CSS shadow layers. */
  boxShadow?: string
}

/** One captured component. */
export interface CaptureRecord {
  /** Always {@link CAPTURE_SCHEMA_VERSION} for records this engine accepts. */
  schemaVersion: number
  /**
   * Stable identifier, unique within a capture set. Stable across recaptures of
   * the same element so provenance survives a re-capture.
   */
  id: string
  componentType: ComponentType
  /** Absolute URL of the page the component was captured from. */
  sourceUrl: string
  /** ISO 8601 UTC instant, e.g. `"2026-02-11T09:14:22.000Z"`. */
  capturedAt: string
  /**
   * Reserved for a future screenshot reference. Screenshots are out of scope
   * for the distillation engine, which never reads pixels; the field exists so
   * the record shape does not have to change when capture grows one.
   */
  screenshot?: null
  styles: CapturedStyles
  /** Free-text human note. Never read by the engine. */
  notes?: string
}

/** A coherent group of captures distilled together into one token set. */
export interface CaptureSet {
  schemaVersion: number
  /** Slug, used as the output directory name. */
  id: string
  name: string
  description: string
  captures: CaptureRecord[]
}
