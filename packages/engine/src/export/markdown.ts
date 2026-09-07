/**
 * Markdown primitives shared by the export targets.
 *
 * Two of them now write documents -- the whole-library `design.md` and the
 * per-component files -- and both are read by an LLM, so column alignment and
 * pluralisation have to be identical between them or the same kit reads as two
 * kits. Deterministic by construction: no locale-aware formatting anywhere.
 */

/** `1 origin` / `5 origins`, so a spec never reads like a template. */
export function plural(count: number, noun: string, plural?: string): string {
  return `${count} ${count === 1 ? noun : (plural ?? `${noun}s`)}`
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length)
}

/** Render a GitHub-flavoured markdown table with aligned columns. */
export function table(headers: readonly string[], rows: ReadonlyArray<readonly string[]>): string[] {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? '').length)),
  )
  const line = (cells: readonly string[]): string =>
    `| ${cells.map((cell, index) => pad(cell, widths[index] as number)).join(' | ')} |`
  return [
    line(headers),
    `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`,
    ...rows.map((row) => line(row)),
  ]
}

/** Collapse blank-line runs and end with exactly one newline. */
export function finish(lines: readonly string[]): string {
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`
}
