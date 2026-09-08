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

/**
 * One cell, made safe for a pipe-delimited row.
 *
 * Cells carry reviewer prose: an override's reason reaches `design.md` and the
 * per-component files verbatim. An ordinary `|` in "8px is too tight | 12px
 * reads better" splits the row into extra columns and corrupts the table for
 * every reader of the primary deliverable, and a newline ends the row outright.
 * Both are neutralised here rather than at each call site, so a new export
 * target inherits it instead of having to remember, and before the widths are
 * measured so the columns still line up on the escaped text.
 */
function cell(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\|/g, '\\|')
}

/** Render a GitHub-flavoured markdown table with aligned columns. */
export function table(headers: readonly string[], rows: ReadonlyArray<readonly string[]>): string[] {
  const safeHeaders = headers.map(cell)
  const safeRows = rows.map((row) => row.map(cell))
  const widths = safeHeaders.map((header, index) =>
    Math.max(header.length, ...safeRows.map((row) => (row[index] ?? '').length)),
  )
  const line = (cells: readonly string[]): string =>
    `| ${cells.map((value, index) => pad(value, widths[index] as number)).join(' | ')} |`
  return [
    line(safeHeaders),
    `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`,
    ...safeRows.map((row) => line(row)),
  ]
}

/** Collapse blank-line runs and end with exactly one newline. */
export function finish(lines: readonly string[]): string {
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`
}
