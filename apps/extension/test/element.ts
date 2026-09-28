/**
 * One element descriptor, built from the values a real browser reports.
 *
 * Shared by the type-guess and boundary suites because they read the same
 * descriptor and the interesting cases are the same pages. The defaults are
 * deliberately the *invisible* box -- transparent, unbordered, unpadded -- since
 * that is what an untouched `<div>` on a real site actually is, and a test that
 * had to opt into being invisible would not be testing what went wrong.
 */
import type { ElementDescriptor } from '../src/shared/descriptor'

export function describeAs(overrides: Partial<ElementDescriptor> = {}): ElementDescriptor {
  return {
    tagName: 'div',
    role: null,
    inputType: null,
    hasBlockChildren: false,
    childElementCount: 0,
    textLength: 0,
    width: 200,
    height: 60,
    backgroundColor: 'rgba(0, 0, 0, 0)',
    painted: null,
    borderWidth: 0,
    hasShadow: false,
    padding: [0, 0, 0, 0],
    viewportWidth: 1440,
    ...overrides,
  }
}

/** A descriptor that paints an opaque fill of its own. */
export function filled(color: string, overrides: Partial<ElementDescriptor> = {}): ElementDescriptor {
  return describeAs({ backgroundColor: color, painted: { color, inherited: false }, ...overrides })
}

/** A descriptor that is transparent, sitting on `color`. */
export function onTop(color: string, overrides: Partial<ElementDescriptor> = {}): ElementDescriptor {
  return describeAs({ backgroundColor: 'rgba(0, 0, 0, 0)', painted: { color, inherited: true }, ...overrides })
}
