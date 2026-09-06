/**
 * Right column: the system.
 *
 * A read-only summary of the kit on screen, plus the two downloads. Editing,
 * overriding and the runner-up choices the engine already records in every
 * token's provenance are the next task's work -- the seam is that this panel
 * reads `tokens` and nothing else, so an editor lands here without moving
 * anything.
 *
 * Diagnostics are shown rather than hidden. A kit that had to adjust a colour
 * for contrast, or that fell back to a stated default, is supposed to say so.
 */
import type { ReactNode } from 'react'
import { AlertTriangle, Download, Info, Loader2, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { TokensDocument } from '@ingot/engine'
import type { KitSummary } from '@/lib/api'

export interface SystemPanelProps {
  kit: KitSummary | null
  tokens: TokensDocument | null
  scopeLabel: string
  captureCount: number
  generating: boolean
  error: string | null
  onGenerate: () => void
  onDownload: (file: 'tokens.json' | 'design.md') => void
}

export function SystemPanel({
  kit,
  tokens,
  scopeLabel,
  captureCount,
  generating,
  error,
  onGenerate,
  onDownload,
}: SystemPanelProps): ReactNode {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">System</h2>
        <Button size="sm" onClick={onGenerate} disabled={generating || captureCount === 0}>
          {generating ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
          Generate kit
        </Button>
      </header>

      {error === null ? null : (
        <p className="border-b border-border px-4 py-3 text-xs text-destructive">{error}</p>
      )}

      {tokens === null || kit === null ? (
        <p className="px-4 py-6 text-xs leading-relaxed text-muted-foreground">
          No kit for <span className="font-medium text-foreground">{scopeLabel}</span> yet.
          {captureCount === 0
            ? ' Import some captures first.'
            : ` Generate one from the ${captureCount} capture${captureCount === 1 ? '' : 's'} in this scope.`}
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Section title="Kit">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
              <Field label="Set" value={kit.setId} mono />
              <Field label="Version" value={`v${kit.version}`} />
              <Field label="Engine" value={kit.engineVersion} mono />
              <Field label="Captures" value={String(kit.captureIds.length)} />
              <Field label="Mode" value={tokens.color.mode} />
            </dl>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="outline" className="flex-1" onClick={() => onDownload('design.md')}>
                <Download aria-hidden />
                design.md
              </Button>
              <Button size="sm" variant="outline" className="flex-1" onClick={() => onDownload('tokens.json')}>
                <Download aria-hidden />
                tokens.json
              </Button>
            </div>
          </Section>

          <Section title="Palette">
            <ul className="grid grid-cols-1 gap-1.5">
              {Object.entries(tokens.color.roles).map(([role, token]) =>
                token === undefined ? null : (
                  <li key={role} className="flex items-center gap-2 text-xs">
                    <span
                      className="size-5 shrink-0 rounded border border-border"
                      style={{ background: token.value.hex }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">{role}</span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{token.value.hex}</span>
                  </li>
                ),
              )}
            </ul>
          </Section>

          <Section title={`Spacing · ${tokens.spacing.baseUnit}px base`}>
            <div className="flex flex-wrap gap-1">
              {tokens.spacing.steps.map((step) => (
                <Badge key={step.value.name} variant={step.value.band === 'layout' ? 'outline' : 'default'}>
                  {step.value.name} · {step.value.px}px
                </Badge>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{tokens.spacing.snappingRule}</p>
          </Section>

          <Section title="Radius and border">
            <div className="flex flex-wrap gap-1">
              {Object.entries(tokens.radius.steps).map(([name, token]) =>
                token === undefined ? null : (
                  <Badge key={name} variant="outline">
                    {name} · {token.value}px
                  </Badge>
                ),
              )}
              <Badge variant="outline">border · {tokens.border.width.value}px</Badge>
            </div>
          </Section>

          <Section title="Typography">
            <p className="text-xs">
              <span className="font-medium">{shortFamily(tokens.typography.families.sans.value)}</span>
              <span className="text-muted-foreground">
                {' '}
                · {tokens.typography.baseSize}px base · {tokens.typography.scaleRatio} ratio
              </span>
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {tokens.typography.steps.map((step) => (
                <Badge key={step.value.name} variant="outline">
                  {step.value.name} · {step.value.fontSize}px
                </Badge>
              ))}
            </div>
          </Section>

          <Section title={`Contrast · ${tokens.color.contrast.length} pairs enforced`}>
            <ul className="flex flex-col gap-1 text-[11px]">
              {tokens.color.contrast.map((pair) => (
                <li key={`${pair.foreground}-on-${pair.background}`} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {pair.foreground} on {pair.background}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums">{pair.ratio.toFixed(2)}:1</span>
                </li>
              ))}
            </ul>
          </Section>

          {tokens.diagnostics.length === 0 ? null : (
            <Section title={`Diagnostics · ${tokens.diagnostics.length}`}>
              <ul className="flex flex-col gap-2">
                {tokens.diagnostics.map((diagnostic) => (
                  <li key={`${diagnostic.code}-${diagnostic.path ?? ''}`} className="flex gap-2 text-[11px]">
                    {diagnostic.level === 'warning' ? (
                      <AlertTriangle className="mt-px size-3 shrink-0 text-destructive" aria-hidden />
                    ) : (
                      <Info className="mt-px size-3 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <span className="leading-relaxed text-muted-foreground">
                      <span className="font-mono text-foreground">{diagnostic.code}</span> {diagnostic.message}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section className="border-b border-border px-4 py-3 last:border-b-0">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }): ReactNode {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? 'truncate font-mono' : 'truncate'}>{value}</dd>
    </>
  )
}

/** Font stacks are long; the first family is the one the user recognises. */
function shortFamily(stack: string): string {
  return (stack.split(',')[0] ?? stack).replace(/["']/g, '').trim()
}
