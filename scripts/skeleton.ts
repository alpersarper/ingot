#!/usr/bin/env tsx
/**
 * The walking skeleton: fixtures in, `examples/<set>/tokens.json` and
 * `examples/<set>/design.md` out.
 *
 *   pnpm skeleton          regenerate every example
 *   pnpm skeleton --check  regenerate in memory and fail on any drift
 *
 * `--check` is what proves the determinism claim in CI: the committed examples
 * are the expected output, and a byte of drift is a failure.
 */
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { distill, renderDesignMarkdown, serializeTokens } from '@ingot/engine'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURES = join(ROOT, 'fixtures')
const EXAMPLES = join(ROOT, 'examples')

interface Output {
  path: string
  contents: string
}

/** Every fixture set directory, sorted so runs are ordered identically. */
export async function fixtureSetIds(): Promise<string[]> {
  const entries = await readdir(FIXTURES, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/** Distil one fixture set into the exact files that belong in `examples/`. */
export async function renderSet(setId: string): Promise<Output[]> {
  const raw = await readFile(join(FIXTURES, setId, 'set.json'), 'utf8')
  const tokens = distill(JSON.parse(raw))
  if (tokens.source.setId !== setId) {
    throw new Error(
      `fixtures/${setId}/set.json declares id "${tokens.source.setId}"; it must match its directory name`,
    )
  }
  return [
    { path: join(EXAMPLES, setId, 'tokens.json'), contents: serializeTokens(tokens) },
    { path: join(EXAMPLES, setId, 'design.md'), contents: renderDesignMarkdown(tokens) },
  ]
}

async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

/** True when this file was run directly rather than imported by a test. */
function isEntryPoint(): boolean {
  const entry = process.argv[1]
  return entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check')
  const setIds = await fixtureSetIds()
  if (setIds.length === 0) throw new Error(`no fixture sets found under ${FIXTURES}`)

  const drift: string[] = []
  for (const setId of setIds) {
    for (const output of await renderSet(setId)) {
      const shown = relative(ROOT, output.path)
      if (check) {
        const existing = await readIfExists(output.path)
        if (existing === undefined) drift.push(`${shown}: missing`)
        else if (existing !== output.contents) drift.push(`${shown}: differs from the committed copy`)
        else process.stdout.write(`  ok    ${shown}\n`)
      } else {
        await mkdir(dirname(output.path), { recursive: true })
        await writeFile(output.path, output.contents, 'utf8')
        process.stdout.write(`  wrote ${shown}\n`)
      }
    }
  }

  if (drift.length > 0) {
    process.stderr.write(`\nexamples are out of date:\n${drift.map((line) => `  - ${line}`).join('\n')}\n`)
    process.stderr.write('\nRun `pnpm skeleton` and commit the result.\n')
    process.exitCode = 1
    return
  }

  process.stdout.write(`\n${check ? 'checked' : 'regenerated'} ${setIds.length} fixture set(s)\n`)
}

if (isEntryPoint()) await main()
