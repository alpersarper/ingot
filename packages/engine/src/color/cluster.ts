/**
 * Near-duplicate colour clustering.
 *
 * Real sites use `#fdfdfd` where they meant `#ffffff`, and a distilled kit that
 * carries both is not a kit. Clustering merges colours that are perceptually
 * the same into one candidate before roles are assigned.
 */
import { byNumber, byString, chain } from '../util/sort'
import type { CaptureRecord } from '../capture/types'
import { hasVisibleBorder } from '../capture/read'
import { colorDistance, meanColor, parseColor, roundOklch } from './space'
import type { Oklch } from './space'

/**
 * Merge radius in OKLab units.
 *
 * 0.012 is roughly the point where two flat swatches stop being separable side
 * by side. It comfortably merges `#ffffff`/`#fdfdfd` (0.006 apart) while
 * keeping `#ffffff`/`#f6f9fc` (0.019) and `#333333`/`#2f2f2f` (0.016) distinct,
 * which is the behaviour the fixture sets are built to exercise.
 */
export const CLUSTER_RADIUS = 0.012

/** Which CSS property a colour was read from. Drives role assignment. */
export type ColorChannel = 'background' | 'foreground' | 'border'

/** One colour reading from one capture. */
export interface ColorObservation {
  captureId: string
  channel: ColorChannel
  /** Raw string as captured. */
  raw: string
  /** Lowercase `#rrggbb`, alpha discarded. The clustering key. */
  hex: string
  oklch: Oklch
  alpha: number
}

/** A group of perceptually identical colours. */
export interface ColorCluster {
  /** Stable identifier: the representative hex. */
  id: string
  /** The member that represents the cluster; what the token actually emits. */
  hex: string
  oklch: Oklch
  /** Weighted OKLab mean of all members. Reported, never emitted as a token. */
  centroid: Oklch
  count: number
  /** Observation count per channel. */
  channels: Record<ColorChannel, number>
  captureIds: string[]
  members: Array<{ hex: string; count: number; captureIds: string[] }>
}

/**
 * Read every colour in the set.
 *
 * A capture's border colour is only read when the capture actually draws a
 * border: browsers report `border-color` even when `border-width` is 0, and
 * that phantom value is usually the element's text colour.
 */
export function readColors(captures: readonly CaptureRecord[]): ColorObservation[] {
  const out: ColorObservation[] = []

  const push = (capture: CaptureRecord, channel: ColorChannel, raw: string | undefined): void => {
    if (raw === undefined) return
    const parsed = parseColor(raw)
    if (!parsed) return
    out.push({
      captureId: capture.id,
      channel,
      raw: raw.trim(),
      hex: parsed.hex,
      oklch: parsed.oklch,
      alpha: parsed.alpha,
    })
  }

  for (const capture of captures) {
    push(capture, 'background', capture.styles.backgroundColor)
    push(capture, 'foreground', capture.styles.color)
    if (hasVisibleBorder(capture)) push(capture, 'border', capture.styles.borderColor)
  }

  return out
}

interface Bucket {
  hex: string
  count: number
  captureIds: Set<string>
  oklch: Oklch
  channels: Record<ColorChannel, number>
}

/**
 * Leader clustering over distinct colours.
 *
 * Distinct colours are visited in a fixed order (most observed first, byte
 * order to break ties) and each either joins the first existing cluster whose
 * running centroid is within {@link CLUSTER_RADIUS} or opens a new one.
 * Comparing against the centroid rather than any member is what stops a long
 * ramp of near-neighbours from chaining into one cluster.
 */
export function clusterColors(observations: readonly ColorObservation[]): ColorCluster[] {
  const buckets = new Map<string, Bucket>()
  for (const observation of observations) {
    let bucket = buckets.get(observation.hex)
    if (!bucket) {
      bucket = {
        hex: observation.hex,
        count: 0,
        captureIds: new Set(),
        oklch: observation.oklch,
        channels: { background: 0, foreground: 0, border: 0 },
      }
      buckets.set(observation.hex, bucket)
    }
    bucket.count += 1
    bucket.captureIds.add(observation.captureId)
    bucket.channels[observation.channel] += 1
  }

  const ordered = [...buckets.values()].sort(
    chain<Bucket>((a, b) => byNumber(b.count, a.count), (a, b) => byString(a.hex, b.hex)),
  )

  const clusters: Array<{ members: Bucket[]; centroid: Oklch }> = []
  for (const bucket of ordered) {
    const target = clusters.find((cluster) => colorDistance(cluster.centroid, bucket.oklch) <= CLUSTER_RADIUS)
    if (target) {
      target.members.push(bucket)
      target.centroid = meanColor(target.members.map((m) => ({ color: m.oklch, weight: m.count })))
    } else {
      clusters.push({ members: [bucket], centroid: bucket.oklch })
    }
  }

  return clusters
    .map(({ members, centroid }) => {
      // The representative is the member that most often *filled* something.
      // Between `#0b76ef` on a button and `#0a74ec` on a link, the button fill
      // is the brand colour and the link tint is the accident.
      const representative = [...members].sort(
        chain<Bucket>(
          (a, b) => byNumber(b.channels.background, a.channels.background),
          (a, b) => byNumber(b.count, a.count),
          (a, b) => byString(a.hex, b.hex),
        ),
      )[0] as Bucket
      const channels: Record<ColorChannel, number> = { background: 0, foreground: 0, border: 0 }
      const captureIds = new Set<string>()
      let count = 0
      for (const member of members) {
        count += member.count
        for (const id of member.captureIds) captureIds.add(id)
        channels.background += member.channels.background
        channels.foreground += member.channels.foreground
        channels.border += member.channels.border
      }
      return {
        id: representative.hex,
        hex: representative.hex,
        oklch: roundOklch(representative.oklch),
        centroid: roundOklch(centroid),
        count,
        channels,
        captureIds: [...captureIds].sort(byString),
        members: members
          .map((member) => ({
            hex: member.hex,
            count: member.count,
            captureIds: [...member.captureIds].sort(byString),
          }))
          .sort(chain((a, b) => byNumber(b.count, a.count), (a, b) => byString(a.hex, b.hex))),
      }
    })
    .sort(chain<ColorCluster>((a, b) => byNumber(b.count, a.count), (a, b) => byString(a.hex, b.hex)))
}
