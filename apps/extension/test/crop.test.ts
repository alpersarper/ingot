/**
 * The crop box.
 *
 * `captureVisibleTab` hands back the viewport at device pixels while the
 * element's rect is in CSS pixels. On a 1x display the two agree and every bug
 * here is invisible; on a retina display, forgetting the ratio crops the
 * top-left quarter of every component captured. Hence a test that is mostly
 * about 2x.
 */
import { describe, expect, it } from 'vitest'
import { cropBox } from '../src/background/crop'

const IMAGE_1X = { width: 1440, height: 900 }
const IMAGE_2X = { width: 2880, height: 1800 }

describe('cropBox', () => {
  it('is the rect itself at 1x', () => {
    expect(cropBox({ x: 100, y: 50, width: 200, height: 40 }, 1, IMAGE_1X)).toEqual({
      x: 100,
      y: 50,
      width: 200,
      height: 40,
    })
  })

  it('scales to device pixels at 2x', () => {
    expect(cropBox({ x: 100, y: 50, width: 200, height: 40 }, 2, IMAGE_2X)).toEqual({
      x: 200,
      y: 100,
      width: 400,
      height: 80,
    })
  })

  it('grows outward on a fractional rect, so no edge is shaved off', () => {
    expect(cropBox({ x: 10.4, y: 20.6, width: 99.3, height: 30.2 }, 1, IMAGE_1X)).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 31,
    })
  })

  it('clamps an element that runs past the bottom of the viewport', () => {
    const box = cropBox({ x: 0, y: 860, width: 300, height: 200 }, 1, IMAGE_1X)
    expect(box).toEqual({ x: 0, y: 860, width: 300, height: 40 })
  })

  it('clamps an element that starts above the viewport', () => {
    expect(cropBox({ x: -20, y: -30, width: 120, height: 60 }, 1, IMAGE_1X)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 30,
    })
  })

  it('has nothing to crop when the element is scrolled out of sight', () => {
    // A viewport screenshot has no pixels of it, and a zero-by-zero PNG would
    // be worse than saying so.
    expect(cropBox({ x: 0, y: 1200, width: 100, height: 40 }, 1, IMAGE_1X)).toBeNull()
  })

  it('treats a missing device pixel ratio as 1 rather than collapsing the box', () => {
    expect(cropBox({ x: 0, y: 0, width: 50, height: 20 }, 0, IMAGE_1X)).toEqual({
      x: 0,
      y: 0,
      width: 50,
      height: 20,
    })
  })
})
