/**
 * Dark and light, in shadcn's convention: a `dark` class on `<html>`.
 *
 * The panel remembers an explicit choice and otherwise follows the OS, which is
 * the behaviour a user who has already picked a theme system-wide expects.
 */
export type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'ingot.theme'

function prefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function storedTheme(): Theme {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(theme: Theme): void {
  const dark = theme === 'dark' || (theme === 'system' && prefersDark())
  document.documentElement.classList.toggle('dark', dark)
  try {
    if (theme === 'system') window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // A session-only theme is better than a crash.
  }
}

export function applyStoredTheme(): void {
  applyTheme(storedTheme())
}
