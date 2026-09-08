/**
 * The one element that carries a kit.
 *
 * Everything drawn from the user's tokens lives inside one of these: the live
 * preview, every docs page, and the static export's body. Nothing inside
 * reaches for a panel colour, and nothing outside is affected, because the kit
 * is a set of custom properties scoped to this element rather than to `:root`.
 *
 * That scoping is what lets a dark kit render as itself inside a light panel --
 * and it is what makes swapping the kit, or swapping to the counterpart theme,
 * a change to one style object.
 */
import type { CSSProperties, ReactNode } from 'react'
import type { TokensDocument } from '@ingot/engine'
import { kitCssVariables } from './kit-css'
import './canonical.css'

export function KitFrame({
  tokens,
  className,
  children,
}: {
  tokens: TokensDocument
  className?: string
  children: ReactNode
}): ReactNode {
  return (
    <div
      className={className === undefined ? 'kit-surface' : `kit-surface ${className}`}
      style={kitCssVariables(tokens) as CSSProperties}
    >
      {children}
    </div>
  )
}
