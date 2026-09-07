/**
 * The centre column: the kit, applied.
 *
 * Two views of one thing. **Preview** is a realistic screen -- the approved
 * skeleton makes it the main view because the user's real question is not "am I
 * faithful to the capture" but "will my app look good". **Docs** is the same
 * components, one at a time, with their values and rules; it is the same
 * renderer, so the two can never disagree.
 *
 * The theme control swaps the token set the whole column is drawn from. The
 * kit's own mode is the truth and the one that exports; the counterpart is
 * derived here for looking at, and says so.
 */
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ComponentDocId, TokensDocument } from '@ingot/engine'
import { KitDocs } from '@/docs/KitDocs'
import { KitFrame } from './KitFrame'
import { SampleScreen } from './gallery'
import { counterpartTokens, modeOf } from './counterpart'
import type { PreviewTheme } from './counterpart'

export type PreviewView = 'preview' | 'docs'

export interface CanonicalPreviewProps {
  tokens: TokensDocument
  view: PreviewView
  onChangeView: (view: PreviewView) => void
  theme: PreviewTheme
  onChangeTheme: (theme: PreviewTheme) => void
}

export function CanonicalPreview({
  tokens,
  view,
  onChangeView,
  theme,
  onChangeTheme,
}: CanonicalPreviewProps): ReactNode {
  const [component, setComponent] = useState<ComponentDocId>('button')

  // Deriving the counterpart walks the whole palette and re-enforces every
  // contrast pair, so it is memoised on the document rather than recomputed on
  // each keystroke in the token editor.
  const counterpart = useMemo(() => counterpartTokens(tokens), [tokens])
  const shown = theme === 'kit' ? tokens : counterpart

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1" role="tablist" aria-label="Preview view">
          <ViewTab current={view} value="preview" onSelect={onChangeView}>
            Preview
          </ViewTab>
          <ViewTab current={view} value="docs" onSelect={onChangeView}>
            Docs
          </ViewTab>
        </div>

        <div className="flex items-center gap-2">
          {theme === 'counterpart' ? (
            <span className="text-[11px] text-muted-foreground" title="Derived in the panel; the kit exports in its own mode">
              derived, not exported
            </span>
          ) : null}
          <div className="flex items-center gap-1" role="group" aria-label="Kit theme">
            <ThemeTab current={theme} value="kit" onSelect={onChangeTheme}>
              {modeOf(tokens, 'kit')} · kit
            </ThemeTab>
            <ThemeTab current={theme} value="counterpart" onSelect={onChangeTheme}>
              {modeOf(tokens, 'counterpart')}
            </ThemeTab>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <KitFrame tokens={shown} className="min-h-full">
          {view === 'preview' ? (
            <SampleScreen tokens={shown} />
          ) : (
            <KitDocs tokens={shown} active={component} onSelect={setComponent} />
          )}
        </KitFrame>
      </div>
    </div>
  )
}

function ViewTab({
  current,
  value,
  onSelect,
  children,
}: {
  current: PreviewView
  value: PreviewView
  onSelect: (view: PreviewView) => void
  children: ReactNode
}): ReactNode {
  const active = current === value
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => onSelect(value)}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
        active ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

function ThemeTab({
  current,
  value,
  onSelect,
  children,
}: {
  current: PreviewTheme
  value: PreviewTheme
  onSelect: (theme: PreviewTheme) => void
  children: ReactNode
}): ReactNode {
  const active = current === value
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onSelect(value)}
      className={`rounded-md border px-2 py-1 text-[11px] capitalize transition-colors ${
        active ? 'border-border bg-secondary text-secondary-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}
