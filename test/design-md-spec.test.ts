/**
 * DESIGN.md conformance, checked by the specification's own linter.
 *
 * The other export targets are Ingot's, so Ingot's tests are the whole of what
 * "correct" means for them. This one is not: `DESIGN.md` is an open format with
 * an outside owner, and a document that satisfies our reading of the spec while
 * failing the tool everyone else runs is not conformant in any sense that
 * matters. So the check here is not a snapshot of what the generator happens to
 * emit -- it is `@google/design.md lint`, the published CLI, run as a
 * subprocess against the committed examples, pinned in `devDependencies` so a
 * spec release cannot silently change what this suite means.
 *
 * **Errors are the bar, and there are none.** Two warning classes survive on
 * purpose, and they are asserted by name below rather than tolerated by a loose
 * threshold, so a *third* kind of warning appearing is a failure:
 *
 *   - `orphaned-tokens` on `colors.border`. The spec's component sub-tokens are
 *     a closed list with no border colour in it, so no component can reference
 *     the token and the linter is right that nothing does. Dropping the token
 *     would lose the value; the alternative is stating it in prose, which is
 *     what the generator does.
 *   - `contrast-ratio` on `control-disabled`. Held below AA deliberately, which
 *     WCAG 1.4.3 permits for inactive components and the linter does not model.
 *
 * `messy-mixed` carries one more, and it is a real finding rather than a
 * modelling gap: see the assertion at the bottom.
 */
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { DESIGN_MD_SPEC_VERSION } from '@ingot/engine'
import { fixtureSetIds } from '../scripts/skeleton'

const run = promisify(execFile)
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const LINTER = join(ROOT, 'node_modules', '@google', 'design.md', 'dist', 'index.js')

interface Finding {
  severity: 'error' | 'warning' | 'info'
  rule: string
  path?: string
  message: string
}

interface LintReport {
  findings: Finding[]
  summary: { errors: number; warnings: number; infos: number }
}

/** Run the published linter over one committed example. */
async function lint(setId: string): Promise<LintReport> {
  // The CLI exits non-zero when it finds errors, which `execFile` turns into a
  // rejection -- so the report is read off the error as readily as off the
  // result. Failing here on the exit code alone would cost the test the one
  // thing worth printing when it fails: which rule fired, and where.
  try {
    const { stdout } = await run(process.execPath, [LINTER, 'lint', join(ROOT, 'examples', setId, 'DESIGN.md')])
    return JSON.parse(stdout) as LintReport
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout
    if (stdout === undefined || stdout === '') throw error
    return JSON.parse(stdout) as LintReport
  }
}

const setIds = await fixtureSetIds()

/** Everything above `info`, which is where the linter puts its token census. */
function notable(report: LintReport): Finding[] {
  return report.findings.filter((finding) => finding.severity !== 'info')
}

describe('DESIGN.md conformance', () => {
  it('emits the schema version the linter in this lockfile speaks', () => {
    expect(DESIGN_MD_SPEC_VERSION).toBe('alpha')
  })

  it.each(setIds)('lints %s with no errors', async (setId) => {
    const report = await lint(setId)
    // The whole point of the test. Printed as the findings rather than the
    // count, so a failure says what broke instead of that something did.
    expect(report.findings.filter((finding) => finding.severity === 'error')).toEqual([])
    expect(report.summary.errors).toBe(0)
  })

  it.each(setIds)('warns about %s only where the spec cannot say what Ingot means', async (setId) => {
    const report = await lint(setId)
    const unexplained = notable(report).filter(
      (finding) =>
        !(finding.rule === 'orphaned-tokens' && finding.path === 'colors.border') &&
        !(finding.rule === 'contrast-ratio' && finding.path === 'components.control-disabled') &&
        // The one genuine finding, and only in the incoherent set. See below.
        !(setId === 'messy-mixed' && finding.rule === 'contrast-ratio'),
    )
    expect(unexplained).toEqual([])
  })

  it('states the border colour in prose, since no component key can carry it', async () => {
    const report = await lint('stripe-light')
    expect(notable(report)).toContainEqual(
      expect.objectContaining({ rule: 'orphaned-tokens', path: 'colors.border' }),
    )
  })

  /**
   * The coherent sets are the quality bar, and it applies here too.
   *
   * `ghost-warm`, `linear-dark` and `stripe-light` put no *contrast* finding in
   * front of a conformance checker beyond the one disabled pair that is below
   * AA on purpose. `messy-mixed` does, and it is exempt from the ship-quality
   * bar by design -- but the finding it carries is worth naming rather than
   * waving through: its `primary` fill measures 4.4993:1 against
   * `primary-foreground` when the ratio is computed on the emitted hex, where
   * the engine's own enforcement lands it at exactly the 4.5 floor. That is a
   * real half-thousandth gap between what the engine guarantees and what a
   * consumer pasting the hex can measure, not an artifact of the fixture being
   * messy. It is recorded here rather than fixed because closing it means
   * moving the contrast floor itself, which re-renders every example.
   */
  it('puts no contrast finding beyond the disabled pair in front of a coherent set', async () => {
    for (const setId of setIds.filter((id) => id !== 'messy-mixed')) {
      const contrast = notable(await lint(setId)).filter((finding) => finding.rule === 'contrast-ratio')
      expect(contrast.map((finding) => finding.path)).toEqual(['components.control-disabled'])
    }
  })
})
