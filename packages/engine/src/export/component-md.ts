/**
 * Per-component markdown: one file that is enough on its own.
 *
 * The whole-library `design.md` is the right document when someone is building
 * a screen. It is the wrong one when someone is building *a button*: they get
 * six hundred lines about spacing bands and elevation to find eight numbers,
 * and an LLM given the whole file spends its attention on the wrong parts.
 *
 * So the contract for this target is **self-sufficiency**: everything needed to
 * build the component correctly is in the file, and nothing outside it is
 * assumed. That means the component's own geometry, the colour roles it paints
 * with (as values, not as references to a table the reader does not have), the
 * type steps it uses, the states it can be in, and the rules and prohibitions
 * that apply — plus a pasteable custom-property block so the values arrive in
 * code rather than in prose.
 *
 * A sibling of `design-md.ts`, per the architecture rule: target-specific
 * output lives in `src/export/`, never in the token model.
 */
import { componentDoc, docRoles } from './component-doc'
import type { ComponentDoc, ComponentDocId, DocTokenRow } from './component-doc'
import { finish, plural, table } from './markdown'
import { byString } from '../util/sort'
import type { ColorRoleName, TokensDocument, TypeStepName } from '../tokens/types'

/** How each origin is worded for a reader who has to decide what to trust. */
const ORIGIN_WORDS: Record<DocTokenRow['origin'], string> = {
  observed: 'measured in the captures',
  derived: 'computed from another token',
  filled: 'engine default — nothing in the captures described it',
  adjusted: 'measured, then moved to clear the contrast floor',
  overridden: 'set by hand in the panel',
}

/**
 * Render one component's specification as a standalone markdown file.
 *
 * Deterministic and pure, like every other export: a function of the tokens
 * document and the component id.
 */
export function renderComponentMarkdown(tokens: TokensDocument, id: ComponentDocId): string {
  const doc = componentDoc(tokens, id)
  const out: string[] = []
  const push = (...lines: string[]): void => {
    out.push(...lines)
  }

  const overrides = doc.tokens.filter((row) => row.origin === 'overridden')
  // A hand-set colour belongs in the same list: the reader of this file has to
  // know that the brand fill they are about to paint with is somebody's
  // decision, not a measurement.
  const overriddenColors = doc.colors.filter(
    (row, index) =>
      row.origin === 'overridden' &&
      doc.colors.findIndex((other) => other.role === row.role) === index,
  )
  const handSetCount = overrides.length + overriddenColors.length

  push(
    `# ${doc.title} — ${tokens.source.name}`,
    '',
    `Everything needed to build this component is in this file. It is a slice of the \`${tokens.source.setId}\` design system distilled by ${tokens.engine.name} ${tokens.engine.version}; the whole system is in \`design.md\`, but you do not need it to build a ${doc.title.toLowerCase()} correctly.`,
    '',
    doc.summary,
    '',
    `- Colour mode: **${tokens.color.mode}**`,
    `- Base unit: **${tokens.spacing.baseUnit}px** · border **${tokens.border.width.value}px** · body type **${tokens.typography.baseSize}px**`,
    `- Font stack: \`${tokens.typography.families.sans.value}\``,
    '',
  )

  if (handSetCount > 0) {
    push(
      `> **${plural(handSetCount, 'value')} here ${handSetCount === 1 ? 'was' : 'were'} set by hand rather than distilled.** They are binding; the \`Origin\` columns mark each one and the last section says what the engine would have chosen.`,
      '',
    )
  }

  // --- 1. variants ----------------------------------------------------------
  push('## 1. Variants', '')
  if (doc.variants.length === 0) {
    push('This component has one form.', '')
  } else {
    push(
      ...table(
        ['Variant', 'When to use it'],
        doc.variants.map((variant) => [`\`${variant.id}\``, variant.note]),
      ),
      '',
    )
  }

  // --- 2. geometry ----------------------------------------------------------
  push(
    '## 2. Values',
    '',
    'Use these numbers. They are not defaults to adjust: two screens built with a 32px control and a 40px control are two different products, and the reason this file exists is that both readers get the same one.',
    '',
    ...table(
      ['Value', 'Set it to', 'Token path', 'Origin'],
      doc.tokens.map((row) => [
        row.label,
        row.resolved === undefined ? row.value : `\`${row.value}\` (${row.resolved})`,
        `\`${row.path}\``,
        ORIGIN_WORDS[row.origin],
      ]),
    ),
    '',
  )

  // --- 3. colours -----------------------------------------------------------
  push(
    '## 3. Colours',
    '',
    ...table(
      ['Where', 'Role', 'Hex', 'OKLCH', 'Origin'],
      doc.colors.map((row) => [
        row.label,
        row.role === null ? '— (none: transparent)' : `\`${row.role}\``,
        row.hex ?? 'transparent',
        row.role === null ? 'transparent' : (tokens.color.roles[row.role]?.value.oklch ?? '—'),
        row.origin === null ? '—' : ORIGIN_WORDS[row.origin],
      ]),
    ),
    '',
  )

  const pairs = tokens.color.contrast.filter((pair) => {
    const roles = new Set(docRoles(doc) as string[])
    return (
      roles.has(pair.foreground.replace('color.roles.', '')) &&
      roles.has(pair.background.replace('color.roles.', ''))
    )
  })
  if (pairs.length > 0) {
    push(
      'Measured contrast for the pairs this component puts on screen:',
      '',
      ...table(
        ['Foreground', 'Background', 'Ratio', 'Floor', 'Status'],
        pairs.map((pair) => [
          `\`${pair.foreground.replace('color.roles.', '')}\``,
          `\`${pair.background.replace('color.roles.', '')}\``,
          `${pair.ratio}:1`,
          `${pair.floor}:1`,
          pair.passes ? 'pass' : 'FAILS',
        ]),
      ),
      '',
    )
  }

  // --- 4. the pasteable block ----------------------------------------------
  push(
    '## 4. Custom properties',
    '',
    'Paste this and build against the variables rather than retyping the numbers.',
    '',
    '```css',
    ':root {',
    ...cssBlock(tokens, doc),
    '}',
    '```',
    '',
  )

  // --- states ---------------------------------------------------------------
  if (doc.states.length > 0) {
    const ring = tokens.components.states.focusRing
    const stateLines: Array<[string, string]> = []
    for (const state of doc.states) {
      if (state === 'default') stateLines.push(['default', 'The fill, label and border in §3.'])
      if (state === 'hover') stateLines.push(['hover', 'The hover fill in §3. Nothing else moves — no shadow, no transform.'])
      if (state === 'active') {
        stateLines.push([
          'active (pressed)',
          `\`primaryActive\` (${tokens.color.roles.primaryActive?.value.hex ?? 'n/a'}) on a primary fill; every other variant keeps its hover fill.`,
        ])
      }
      if (state === 'focus') {
        stateLines.push([
          'focus',
          `\`outline: ${ring.width.value}px solid ${ringHex(tokens)}\` at \`outline-offset: ${ring.offset.value}px\`. Never removed.`,
        ])
      }
      if (state === 'disabled') {
        stateLines.push([
          'disabled',
          `Fill \`disabledSurface\` (${tokens.color.roles.disabledSurface?.value.hex ?? 'n/a'}), label \`disabledForeground\` (${tokens.color.roles.disabledForeground?.value.hex ?? 'n/a'}) — measured at ${tokens.components.states.disabled.ratio}:1. Keep the border. Never \`opacity\`.`,
        ])
      }
      if (state === 'selected') {
        stateLines.push([
          'selected',
          `Fill \`selectedSurface\` (${tokens.color.roles.selectedSurface?.value.hex ?? 'n/a'}) with \`text\` on top. Selection reads by hue, hover by lightness.`,
        ])
      }
      if (state === 'error') {
        stateLines.push([
          'error',
          tokens.color.roles.destructive === undefined
            ? 'This kit has no destructive colour. Carry the error in the message text and the border stays `border`. Do not introduce a red.'
            : `Border and message in \`destructive\` (${tokens.color.roles.destructive.value.hex}). The control height does not change.`,
        ])
      }
    }
    push('## 5. States', '', ...table(['State', 'How to draw it'], stateLines), '')
  }

  // --- rules ----------------------------------------------------------------
  push('## 6. Rules', '', ...doc.usage.map((rule) => `- ${rule}`), '')
  push('## 7. Do not', '', ...doc.doNot.map((rule) => `- ${rule}`), '')

  if (handSetCount > 0) {
    const colorRows = overriddenColors.flatMap((row) => {
      const token = row.role === null ? undefined : tokens.color.roles[row.role]
      if (token === undefined) return []
      const decision = token.provenance.decision
      return [[`\`color.roles.${row.role}\``, token.value.hex, decision.supersedes?.chosen ?? '—', decision.note ?? '—']]
    })
    push(
      '## 8. What was overridden',
      '',
      ...table(
        ['Value', 'Set to', 'The engine chose', 'Reason given'],
        [
          ...overrides.map((row) => [
            row.label,
            row.value,
            row.provenance.decision.supersedes?.chosen ?? '—',
            row.provenance.decision.note ?? '—',
          ]),
          ...colorRows,
        ],
      ),
      '',
    )
  }

  return finish(out)
}

/**
 * The custom-property block: exactly the variables this component needs.
 *
 * Names match the panel's canonical renderer (`--kit-*`), so the CSS in this
 * file and the component on screen in the workbench are the same component.
 */
function cssBlock(tokens: TokensDocument, doc: ComponentDoc): string[] {
  const lines: string[] = []
  const recipes = tokens.components.recipes.filter((recipe) =>
    doc.variants.some((variant) => variant.recipe === recipe.name),
  )

  // Every role the component paints with, plus the ring colour, which is
  // referenced below whether or not a colour row happened to name it.
  const roles = new Set<ColorRoleName>([
    ...docRoles(doc),
    roleOf(tokens.components.states.focusRing.colorRole),
  ])
  for (const role of [...roles].sort(byString)) {
    const token = tokens.color.roles[role]
    if (token === undefined) continue
    lines.push(`  --kit-color-${kebab(role)}: ${token.value.hex};`)
  }

  // Type steps: the ones the recipes name, and the whole ladder for a doc whose
  // labels, help text or specimen use more than one.
  const steps = new Set<TypeStepName>(recipes.map((recipe) => recipe.typeStep.value))
  if (doc.id === 'typography' || doc.id === 'input' || doc.id === 'select' || doc.id === 'card') {
    for (const step of tokens.typography.steps) steps.add(step.value.name)
  }
  for (const step of tokens.typography.steps) {
    if (!steps.has(step.value.name)) continue
    lines.push(
      `  --kit-text-${step.value.name}-size: ${step.value.fontSize}px;`,
      `  --kit-text-${step.value.name}-leading: ${step.value.lineHeight};`,
      `  --kit-text-${step.value.name}-weight: ${step.value.fontWeight};`,
    )
  }

  for (const [name, token] of Object.entries(tokens.radius.steps)) {
    if (token === undefined) continue
    lines.push(`  --kit-radius-${name}: ${token.value}px;`)
  }
  if (doc.id === 'card' && tokens.shadow.steps.sm !== undefined) {
    lines.push(`  --kit-shadow-sm: ${tokens.shadow.steps.sm.value.css};`)
  }
  for (const step of tokens.spacing.steps) {
    lines.push(`  --kit-space-${step.value.name}: ${step.value.px}px;`)
  }
  lines.push(`  --kit-space-unit: ${tokens.spacing.baseUnit}px;`, `  --kit-border-width: ${tokens.border.width.value}px;`)

  // The recipe block, named exactly as the workbench's canonical renderer names
  // it, so the CSS in this file and the component on screen are one component.
  for (const recipe of recipes) {
    const key = recipe.name.replace(/\./g, '-')
    lines.push(
      `  --kit-${key}-height: ${recipe.height.value}px;`,
      `  --kit-${key}-padding-y: ${recipe.paddingY.value}px;`,
      `  --kit-${key}-padding-x: ${recipe.paddingX.value}px;`,
      `  --kit-${key}-radius: var(--kit-radius-${recipe.radius.value});`,
      `  --kit-${key}-text-size: var(--kit-text-${recipe.typeStep.value}-size);`,
      `  --kit-${key}-text-leading: var(--kit-text-${recipe.typeStep.value}-leading);`,
      `  --kit-${key}-weight: ${recipe.fontWeight.value};`,
      `  --kit-${key}-surface: ${colorRef(recipe.colors.surface)};`,
      `  --kit-${key}-foreground: ${colorRef(recipe.colors.foreground)};`,
      `  --kit-${key}-border: ${colorRef(recipe.colors.border)};`,
      `  --kit-${key}-hover-surface: ${colorRef(recipe.colors.hoverSurface)};`,
    )
  }

  const ring = tokens.components.states.focusRing
  lines.push(
    `  --kit-ring-width: ${ring.width.value}px;`,
    `  --kit-ring-offset: ${ring.offset.value}px;`,
    `  --kit-ring-color: var(--kit-color-${kebab(roleOf(ring.colorRole))});`,
  )

  return lines
}

/** A recipe colour as a variable reference, or the honest `transparent`. */
function colorRef(path: string | null): string {
  return path === null ? 'transparent' : `var(--kit-color-${kebab(roleOf(path))})`
}

function roleOf(path: string): ColorRoleName {
  return path.replace('color.roles.', '') as ColorRoleName
}

/** The focus ring's own colour, resolved through the role it names. */
function ringHex(tokens: TokensDocument): string {
  const role = tokens.components.states.focusRing.colorRole.replace('color.roles.', '') as ColorRoleName
  return tokens.color.roles[role]?.value.hex ?? 'currentColor'
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}
