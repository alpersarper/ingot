/**
 * What a set of captures will cost the kit, said before the generation is spent.
 *
 * Both warnings it renders are invisible on screen and expensive to find out
 * about afterwards: a kit distilled from seven cards, or from one light page and
 * one dark one, comes back looking perfectly finished. The panel knew all of it
 * beforehand and said nothing -- which is the failure mode this product's rules
 * name outright (AGENTS.md: it never goes quiet).
 *
 * Two shapes on purpose. The *fact* is stated first and in the foreground, and
 * the *remedy* follows in muted text, because a reviewer who already knows what
 * they are doing needs only the first line and a reviewer who does not needs the
 * second. Neither disables anything: the buttons underneath stay live, which is
 * the point of a warning rather than a gate.
 */
import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { SelectionWarning } from './selection'

export function SelectionWarnings({
  warnings,
  className,
}: {
  warnings: readonly SelectionWarning[]
  className?: string
}): ReactNode {
  if (warnings.length === 0) return null
  return (
    <ul className={className} aria-label="Warnings about this selection">
      {warnings.map((warning) => (
        <li
          key={warning.id}
          data-testid={`warning-${warning.id}`}
          className="mt-2 flex gap-2 rounded-md border border-border bg-background px-2.5 py-2 text-left"
        >
          <AlertTriangle className="mt-px size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <p className="min-w-0 text-[11px] leading-relaxed">
            <span className="font-medium">{warning.text}</span>{' '}
            <span className="text-muted-foreground">{warning.remedy}</span>
          </p>
        </li>
      ))}
    </ul>
  )
}
