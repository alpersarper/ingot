/**
 * The workbench top bar: identity on the left, session controls on the right.
 * Nothing here changes the kit -- it changes the room the kit is being looked at
 * in, which is why the theme toggle lives here and not in the system panel.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Check, KeyRound, Moon, Sun, Unlink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { applyTheme } from '@/lib/theme'
import { IngotMark } from './FirstRun'
import type { PanelSettings } from '@/lib/api'

export interface TopbarProps {
  settings: PanelSettings | null
  onSaveLlmKey: (key: string) => Promise<void>
  onUnpair: () => void
}

export function Topbar({ settings, onSaveLlmKey, onUnpair }: TopbarProps): ReactNode {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const [editingKey, setEditingKey] = useState(false)
  const [key, setKey] = useState('')
  const [saved, setSaved] = useState(false)

  function toggleTheme(): void {
    const next = dark ? 'light' : 'dark'
    applyTheme(next)
    setDark(next === 'dark')
  }

  async function saveKey(): Promise<void> {
    await onSaveLlmKey(key.trim())
    setKey('')
    setEditingKey(false)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2000)
  }

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border px-3">
      <div className="flex min-w-0 items-center gap-2">
        <IngotMark className="size-6" />
        <span className="text-sm font-semibold tracking-tight">Ingot</span>
        {settings === null ? null : (
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            engine {settings.engine.version} · {settings.storage.adapter}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        {editingKey ? (
          <div className="flex items-center gap-1.5">
            <Label htmlFor="topbar-llm-key" className="sr-only">
              LLM API key
            </Label>
            <Input
              id="topbar-llm-key"
              type="password"
              className="h-8 w-56 font-mono text-xs"
              value={key}
              autoFocus
              placeholder="sk-..."
              onChange={(event) => setKey(event.target.value)}
            />
            <Button size="sm" onClick={() => void saveKey()} disabled={key.trim() === ''}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditingKey(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEditingKey(true)}
            disabled={settings?.llm.managedByEnvironment === true}
            title={
              settings?.llm.managedByEnvironment === true
                ? 'Pinned by INGOT_LLM_API_KEY on the server'
                : 'Stored server-side; never returned to this browser'
            }
          >
            {saved ? <Check aria-hidden /> : <KeyRound aria-hidden />}
            {settings?.llm.configured === true ? 'LLM key set' : 'Add LLM key'}
          </Button>
        )}

        <Button size="icon" variant="ghost" onClick={toggleTheme} aria-label="Toggle theme">
          {dark ? <Sun aria-hidden /> : <Moon aria-hidden />}
        </Button>

        <Button size="sm" variant="ghost" onClick={onUnpair} title="Forget the pairing token in this browser">
          <Unlink aria-hidden />
          Unpair
        </Button>
      </div>
    </header>
  )
}
