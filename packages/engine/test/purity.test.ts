/**
 * The engine's portability contract, enforced by reading its own source.
 *
 * `packages/engine` has to keep running unchanged inside a browser extension, a
 * server-side panel and CI. A single `node:fs` import or `document` reference
 * would break one of those hosts, and it would break it at a point far from
 * where the import was added -- so it is cheaper to fail here.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = join(fileURLToPath(new URL('../src', import.meta.url)))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : []
  })
}

/** Import specifiers the engine is allowed to reach for. */
const ALLOWED_IMPORTS = /^(culori|\.{1,2}\/)/

/**
 * Host globals that would tie the engine to one runtime. Matched as whole
 * identifiers followed by a member access, so the words are still usable in
 * prose and comments.
 */
const FORBIDDEN_GLOBALS = [
  // The trailing identifier requirement keeps a sentence ending in "document."
  // from reading as a DOM access.
  /\bdocument\s*\.\s*[A-Za-z_$]/,
  /\bwindow\s*\.\s*[A-Za-z_$]/,
  /\bnavigator\s*\.\s*[A-Za-z_$]/,
  /\bchrome\s*\.\s*[A-Za-z_$]/,
  /\blocalStorage\b/,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bprocess\s*\.\s*[A-Za-z_$]/,
  /\brequire\s*\(/,
]

/** Sources of non-determinism. Any of these would break byte-identical output. */
const FORBIDDEN_NONDETERMINISM = [/\bMath\s*\.\s*random\b/, /\bDate\s*\.\s*now\b/, /\bnew\s+Date\b/, /\bperformance\s*\.\s*[A-Za-z_$]/]

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('engine portability', () => {
  const files = sourceFiles(SRC)

  it('has sources to check', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it.each(files.map((file) => [file.slice(SRC.length + 1), file]))(
    'src/%s imports nothing host-specific',
    (_name, file) => {
      const source = readFileSync(file, 'utf8')
      const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] as string)
      for (const specifier of specifiers) {
        expect(specifier, `${file} imports ${specifier}`).toMatch(ALLOWED_IMPORTS)
      }
    },
  )

  it.each(files.map((file) => [file.slice(SRC.length + 1), file]))(
    'src/%s touches no host global and no clock',
    (_name, file) => {
      const source = withoutComments(readFileSync(file, 'utf8'))
      for (const pattern of [...FORBIDDEN_GLOBALS, ...FORBIDDEN_NONDETERMINISM]) {
        expect(pattern.test(source), `${file} matches ${pattern}`).toBe(false)
      }
    },
  )
})
