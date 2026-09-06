/**
 * The canonical components.
 *
 * These four -- button, card, input and the type scale -- are the v1 component
 * set, and this file is the seed of the component library the panel will grow:
 * the same components are meant to draw the live preview, the in-panel kit docs
 * and the static export, from one implementation.
 *
 * They take no colours, sizes or spacing as props. Everything visual comes from
 * `var(--kit-*)` through `canonical.css`, which is what makes a kit swap a
 * one-line change and what keeps the preview honest about the exported tokens.
 */
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import type { TypeStep } from '@ingot/engine'

/** The button variants the engine emits recipes for. */
export type KitButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive'

export interface KitButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: KitButtonVariant
}

export function KitButton({ variant = 'primary', type = 'button', ...props }: KitButtonProps): ReactNode {
  return <button {...props} type={type} className="kit-button" data-variant={variant} />
}

export interface KitCardProps {
  title: string
  children?: ReactNode
  actions?: ReactNode
}

export function KitCard({ title, children, actions }: KitCardProps): ReactNode {
  return (
    <div className="kit-card">
      <h3 className="kit-card-title">{title}</h3>
      {children === undefined ? null : <div className="kit-card-body">{children}</div>}
      {actions === undefined ? null : <div className="kit-card-actions">{actions}</div>}
    </div>
  )
}

export interface KitInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: string
}

export function KitInput({ label, hint, id, ...props }: KitInputProps): ReactNode {
  const inputId = id ?? `kit-input-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <div className="kit-field">
      <label className="kit-label" htmlFor={inputId}>
        {label}
      </label>
      <input {...props} id={inputId} className="kit-input" />
      {hint === undefined ? null : <p className="kit-hint">{hint}</p>}
    </div>
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
