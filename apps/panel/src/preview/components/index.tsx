/**
 * The canonical components.
 *
 * One implementation, three surfaces: this file draws the live preview, the
 * in-panel kit docs and the static docs export. That was the captain's call and
 * it is the reason none of these components take a colour, a size or a spacing
 * as a prop — everything visual comes from `var(--kit-*)` through
 * `canonical.css`, so a kit swap is a change to one style object and a docs page
 * cannot drift from the preview beside it.
 *
 * The craft lives here in the markup and in the stylesheet: padding rhythm,
 * focus behaviour, which element carries which state. Tokens paint; they cannot
 * break the skeleton.
 *
 * `state` is the one prop that looks like styling and is not. A documentation
 * page has to show what hover and pressed look like without a pointer, so every
 * interactive component accepts a forced state that the stylesheet matches with
 * exactly the same rules as the real `:hover` and `:active`. Two selectors, one
 * declaration block — a docs page that showed a hand-written approximation of
 * hover would be the same lie as a hardcoded colour.
 */
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react'
import type { TypeStep } from '@ingot/engine'

/** The button variants the engine emits recipes for. */
export type KitButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive'

/**
 * A state drawn on demand rather than by the pointer.
 *
 * `disabled` is not in this list: it is a real DOM attribute and forcing it
 * would mean drawing a disabled control that is still clickable.
 */
export type KitForcedState = 'hover' | 'active' | 'focus'

interface Forceable {
  state?: KitForcedState | undefined
}

/** `data-force` only when a state is actually being forced, so the DOM stays clean. */
function force(state: KitForcedState | undefined): { 'data-force'?: KitForcedState } {
  return state === undefined ? {} : { 'data-force': state }
}

export interface KitButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, Forceable {
  variant?: KitButtonVariant
}

export function KitButton({ variant = 'primary', type = 'button', state, ...props }: KitButtonProps): ReactNode {
  return <button {...props} {...force(state)} type={type} className="kit-button" data-variant={variant} />
}

export interface KitCardProps {
  title: string
  children?: ReactNode
  actions?: ReactNode
  /** A quiet line under the title: a metric caption, a status, a count. */
  meta?: ReactNode
}

export function KitCard({ title, children, actions, meta }: KitCardProps): ReactNode {
  return (
    <div className="kit-card">
      <div className="kit-card-head">
        <h3 className="kit-card-title">{title}</h3>
        {meta === undefined ? null : <p className="kit-card-meta">{meta}</p>}
      </div>
      {children === undefined ? null : <div className="kit-card-body">{children}</div>}
      {actions === undefined ? null : <div className="kit-card-actions">{actions}</div>}
    </div>
  )
}

/**
 * A stat tile: the shape a dashboard is actually made of.
 *
 * It is a card with a number in it rather than a new component, because the
 * kit has no stat-tile recipe and inventing one would be inventing evidence.
 */
export function KitStat({ label, value, hint }: { label: string; value: string; hint?: string }): ReactNode {
  return (
    <div className="kit-card kit-stat">
      <p className="kit-stat-label">{label}</p>
      <p className="kit-stat-value">{value}</p>
      {hint === undefined ? null : <p className="kit-stat-hint">{hint}</p>}
    </div>
  )
}

interface FieldFrameProps {
  label: string
  hint: string | undefined
  /** An error message. Present means the field is invalid. */
  error: string | undefined
  id: string
  children: ReactNode
}

/**
 * Label above, control, then help text or the error message in its place.
 *
 * The message sits below the control and the control's height never changes,
 * so a form does not jump when a field goes invalid.
 */
function FieldFrame({ label, hint, error, id, children }: FieldFrameProps): ReactNode {
  return (
    <div className="kit-field" data-invalid={error === undefined ? undefined : 'true'}>
      <label className="kit-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error !== undefined ? (
        <p className="kit-error" id={`${id}-message`} role="alert">
          {error}
        </p>
      ) : hint !== undefined ? (
        <p className="kit-hint" id={`${id}-message`}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}

function fieldId(label: string, given: string | undefined, prefix: string): string {
  return given ?? `kit-${prefix}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
}

export interface KitInputProps extends InputHTMLAttributes<HTMLInputElement>, Forceable {
  label: string
  hint?: string
  error?: string
}

export function KitInput({ label, hint, error, id, state, ...props }: KitInputProps): ReactNode {
  const inputId = fieldId(label, id, 'input')
  return (
    <FieldFrame label={label} hint={hint} error={error} id={inputId}>
      <input
        {...props}
        {...force(state)}
        id={inputId}
        className="kit-input"
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={hint === undefined && error === undefined ? undefined : `${inputId}-message`}
      />
    </FieldFrame>
  )
}

export interface KitSelectProps extends SelectHTMLAttributes<HTMLSelectElement>, Forceable {
  label: string
  hint?: string
  error?: string
  options: readonly string[]
}

export function KitSelect({ label, hint, error, options, id, state, ...props }: KitSelectProps): ReactNode {
  const selectId = fieldId(label, id, 'select')
  return (
    <FieldFrame label={label} hint={hint} error={error} id={selectId}>
      {/* The chevron is drawn by the stylesheet from `currentColor`, so it is
          the control's own label colour rather than an imported icon asset. */}
      <div className="kit-select-shell">
        <select
          {...props}
          {...force(state)}
          id={selectId}
          className="kit-select"
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={hint === undefined && error === undefined ? undefined : `${selectId}-message`}
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <span className="kit-select-chevron" aria-hidden />
      </div>
    </FieldFrame>
  )
}

export interface KitBadgeProps {
  children: ReactNode
  /** `destructive` is the only tone this kit sanctions beyond the default one. */
  tone?: 'default' | 'destructive'
}

export function KitBadge({ children, tone = 'default' }: KitBadgeProps): ReactNode {
  return (
    <span className="kit-badge" data-tone={tone}>
      {children}
    </span>
  )
}

export interface KitTableColumn {
  key: string
  label: string
  /** Right-aligned for numbers, which is the only alignment rule a kit needs. */
  numeric?: boolean
}

export interface KitTableRow {
  key: string
  cells: Record<string, ReactNode>
  /** Drawn as the selected row: `selectedSurface`, not the hover fill. */
  selected?: boolean
  /** Drawn as the hovered row, for a docs page with no pointer in it. */
  hovered?: boolean
}

export function KitTable({
  columns,
  rows,
  caption,
}: {
  columns: readonly KitTableColumn[]
  rows: readonly KitTableRow[]
  caption?: string
}): ReactNode {
  return (
    <table className="kit-table">
      {caption === undefined ? null : <caption className="kit-table-caption">{caption}</caption>}
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key} scope="col" data-numeric={column.numeric === true ? 'true' : undefined}>
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.key}
            data-selected={row.selected === true ? 'true' : undefined}
            data-force={row.hovered === true ? 'hover' : undefined}
          >
            {columns.map((column) => (
              <td key={column.key} data-numeric={column.numeric === true ? 'true' : undefined}>
                {row.cells[column.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * One row of the type scale, drawn at its own step.
 *
 * The sample is set with the step's own variables rather than a class per step,
 * because a kit's step list is whatever its captures supported -- `ghost-warm`
 * has five steps and no `xs`, and hardcoding eight would draw four sizes the
 * kit never claimed.
 */
export function KitTypeRow({ step }: { step: TypeStep }): ReactNode {
  return (
    <div className="kit-type-row">
      <span
        className="kit-type-sample"
        style={{
          fontSize: `var(--kit-text-${step.name}-size)`,
          lineHeight: `var(--kit-text-${step.name}-leading)`,
          fontWeight: `var(--kit-text-${step.name}-weight)`,
          letterSpacing: `var(--kit-text-${step.name}-tracking)`,
        }}
      >
        The quick brown fox
      </span>
      <span className="kit-type-meta">
        {step.name} · {step.fontSize}px / {step.lineHeight} · {step.fontWeight}
      </span>
    </div>
  )
}

/** A labelled row of specimens, used by the preview and by every docs page. */
export function KitSpecimen({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="kit-specimen">
      <p className="kit-specimen-label">{label}</p>
      <div className="kit-specimen-body">{children}</div>
    </div>
  )
}
