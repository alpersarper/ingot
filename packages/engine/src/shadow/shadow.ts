/**
 * Box-shadow distillation.
 *
 * Shadows are parsed into layers, ordered by how much elevation they imply, and
 * assigned to `sm`/`md`/`lg`. Nothing is invented from an empty set: a kit whose
 * sources use no shadows gets no shadow scale, only `none`.
 */
import { byNumber, byString, chain } from '../util/sort'
import { clamp, round } from '../util/num'
import type { CaptureRecord } from '../capture/types'
import { decide, derive, provenance, tally } from '../provenance'
import type { Contribution } from '../provenance'
import type { Diagnostic, ShadowLayer, ShadowStepName, ShadowTokens, ShadowValue, Token } from '../tokens/types'
import { parseColor } from '../color/space'

/** How many distinct shadows the scale keeps. */
const MAX_STEPS = 3

const LENGTH = /^(-?\d+(?:\.\d+)?)px$/

/**
 * Split a `box-shadow` value on top-level commas.
 *
 * A naive `split(',')` breaks `rgba(0, 0, 0, 0.3)` into four pieces, so
 * parenthesis depth is tracked.
 */
function splitLayers(css: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of css) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  parts.push(current)
  return parts.map((part) => part.trim()).filter((part) => part.length > 0)
}

/** Split a layer into whitespace-separated tokens, keeping `rgb(...)` intact. */
function splitTokens(layer: string): string[] {
  const tokens: string[] = []
  let depth = 0
  let current = ''
  for (const char of layer) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (/\s/.test(char) && depth === 0) {
      if (current) tokens.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current) tokens.push(current)
  return tokens
}

/** Canonical `rgb(R G B / A)` form, so equivalent notations compare equal. */
function normalizeShadowColor(raw: string): string | undefined {
  const parsed = parseColor(raw)
  if (!parsed) return undefined
  const hex = parsed.hex
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  return `rgb(${r} ${g} ${b} / ${round(parsed.alpha, 3)})`
}

/**
 * Parse a CSS `box-shadow` value.
 *
 * Returns `undefined` for `none`, for `inset` shadows (an inner shadow is not a
 * point on an elevation scale) and for anything that does not parse cleanly.
 */
export function parseShadow(css: string): ShadowValue | undefined {
  const trimmed = css.trim()
  if (trimmed === '' || trimmed === 'none') return undefined

  const layers: ShadowLayer[] = []
  for (const rawLayer of splitLayers(trimmed)) {
    if (/\binset\b/.test(rawLayer)) return undefined
    const tokens = splitTokens(rawLayer)
    const lengths: number[] = []
    let color: string | undefined
    for (const token of tokens) {
      const match = LENGTH.exec(token)
      if (match) {
        lengths.push(Number(match[1]))
        continue
      }
      if (token === '0') {
        lengths.push(0)
        continue
      }
      const normalized = normalizeShadowColor(token)
      if (normalized === undefined) return undefined
      color = normalized
    }
    if (lengths.length < 2 || lengths.length > 4 || color === undefined) return undefined
    layers.push({
      offsetX: lengths[0] as number,
      offsetY: lengths[1] as number,
      blur: lengths[2] ?? 0,
      spread: lengths[3] ?? 0,
      color,
    })
  }
  if (layers.length === 0) return undefined

  return {
    css: layers.map(formatLayer).join(', '),
    layers,
    elevation: round(
      layers.reduce((sum, layer) => sum + Math.abs(layer.offsetY) + layer.blur + layer.spread, 0),
      3,
    ),
  }
}

function formatLayer(layer: ShadowLayer): string {
  return `${layer.offsetX}px ${layer.offsetY}px ${layer.blur}px ${layer.spread}px ${layer.color}`
}

/** Total alpha across a shadow's layers. Breaks elevation ties toward the lighter shadow. */
function totalAlpha(shadow: ShadowValue): number {
  return round(
    shadow.layers.reduce((sum, layer) => {
      const match = /\/\s*([\d.]+)\)$/.exec(layer.color)
      return sum + (match ? Number(match[1]) : 1)
    }, 0),
    3,
  )
}

/** Scale a shadow's geometry and opacity to synthesise a neighbouring step. */
function scaleShadow(shadow: ShadowValue, geometry: number, alpha: number): ShadowValue {
  const layers = shadow.layers.map((layer) => {
    const match = /^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/.exec(layer.color)
    const nextAlpha = match ? clamp(round(Number(match[4]) * alpha, 3), 0, 1) : 1
    const color = match ? `rgb(${match[1]} ${match[2]} ${match[3]} / ${nextAlpha})` : layer.color
    return {
      offsetX: round(layer.offsetX * geometry, 2),
      offsetY: round(layer.offsetY * geometry, 2),
      blur: round(layer.blur * geometry, 2),
      spread: round(layer.spread * geometry, 2),
      color,
    }
  })
  return {
    css: layers.map(formatLayer).join(', '),
    layers,
    elevation: round(
      layers.reduce((sum, layer) => sum + Math.abs(layer.offsetY) + layer.blur + layer.spread, 0),
      3,
    ),
  }
}

interface ShadowCandidate {
  shadow: ShadowValue
  count: number
  contributions: Contribution[]
}

export function distillShadows(
  captures: readonly CaptureRecord[],
  diagnostics: Diagnostic[],
): ShadowTokens {
  const steps: Partial<Record<ShadowStepName, Token<ShadowValue>>> = {}

  steps.none = {
    value: { css: 'none', layers: [], elevation: 0 },
    provenance: {
      captureIds: [],
      observed: [],
      decision: derive('none', {
        method: 'scale-anchor',
        from: [],
        detail: 'every scale needs an explicit "no shadow" step',
      }),
    },
  }

  const candidates = new Map<string, ShadowCandidate>()
  let unparsed = 0
  for (const capture of captures) {
    const raw = capture.styles.boxShadow
    if (raw === undefined || raw.trim() === 'none' || raw.trim() === '') continue
    const shadow = parseShadow(raw)
    if (!shadow) {
      unparsed += 1
      continue
    }
    const existing = candidates.get(shadow.css)
    const contribution: Contribution = { value: raw.trim(), captureId: capture.id }
    if (existing) {
      existing.count += 1
      existing.contributions.push(contribution)
    } else {
      candidates.set(shadow.css, { shadow, count: 1, contributions: [contribution] })
    }
  }

  if (unparsed > 0) {
    diagnostics.push({
      level: 'warning',
      code: 'shadow.unparsed',
      path: 'shadow',
      message: `${unparsed} box-shadow value(s) could not be parsed as an elevation shadow (inset or unsupported syntax) and were ignored.`,
    })
  }

  if (candidates.size === 0) {
    diagnostics.push({
      level: 'info',
      code: 'shadow.none-observed',
      path: 'shadow',
      message: 'No shadows were captured, so no elevation scale was derived. Use borders for separation.',
    })
    return { steps }
  }

  // Keep the most frequently observed shadows, then order what survives by
  // elevation so sm/md/lg genuinely ascend.
  const kept = [...candidates.values()]
    .sort(
      chain<ShadowCandidate>(
        (a, b) => byNumber(b.count, a.count),
        (a, b) => byNumber(a.shadow.elevation, b.shadow.elevation),
        (a, b) => byString(a.shadow.css, b.shadow.css),
      ),
    )
    .slice(0, MAX_STEPS)
    .sort(
      chain<ShadowCandidate>(
        (a, b) => byNumber(a.shadow.elevation, b.shadow.elevation),
        (a, b) => byNumber(totalAlpha(a.shadow), totalAlpha(b.shadow)),
        (a, b) => byString(a.shadow.css, b.shadow.css),
      ),
    )

  if (candidates.size > MAX_STEPS) {
    const dropped = [...candidates.values()]
      .filter((candidate) => !kept.includes(candidate))
      .map((candidate) => candidate.shadow.css)
      .sort(byString)
    diagnostics.push({
      level: 'info',
      code: 'shadow.truncated',
      path: 'shadow.steps',
      message: `${candidates.size} distinct shadows were observed; kept the ${MAX_STEPS} most frequent. Dropped: ${dropped.join(' | ')}.`,
    })
  }

  const names: ShadowStepName[] = kept.length >= 3 ? ['sm', 'md', 'lg'] : kept.length === 2 ? ['sm', 'md'] : ['md']
  kept.forEach((candidate, index) => {
    const name = names[index] as ShadowStepName
    const observed = tally(candidate.contributions)
    steps[name] = {
      value: candidate.shadow,
      provenance: provenance(observed, decide('dominant-value', candidate.shadow.css, observed, { unit: 'capture' })),
    }
  })

  const md = steps.md
  if (md && !steps.sm) {
    const value = scaleShadow(md.value, 0.5, 0.7)
    steps.sm = {
      value,
      provenance: {
        captureIds: [],
        observed: [],
        decision: derive(value.css, {
          method: 'shadow-scale',
          from: ['shadow.steps.md'],
          detail: 'only one shadow was captured; halved its geometry and dropped opacity to 70% for the low step',
        }),
      },
    }
  }
  if (md && !steps.lg) {
    const value = scaleShadow(md.value, 2.5, 1.15)
    steps.lg = {
      value,
      provenance: {
        captureIds: [],
        observed: [],
        decision: derive(value.css, {
          method: 'shadow-scale',
          from: ['shadow.steps.md'],
          detail: 'no higher shadow was captured; scaled md geometry by 2.5x and opacity by 1.15x',
        }),
      },
    }
  }

  // Reinsert in scale order so the serialised document reads low-to-high.
  const ordered: Partial<Record<ShadowStepName, Token<ShadowValue>>> = {}
  for (const name of ['none', 'sm', 'md', 'lg'] as const) {
    const token = steps[name]
    if (token) ordered[name] = token
  }
  return { steps: ordered }
}
