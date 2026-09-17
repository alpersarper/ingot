/**
 * Build the unpacked extension into `dist/`.
 *
 * Three bundles, because there are three JavaScript contexts and they cannot
 * share one: the service worker (ESM, as the manifest declares), the content
 * script (IIFE -- an injected script has no module loader), and the options
 * page. Everything else is copied.
 *
 * The icons are drawn here rather than committed. Three PNGs of a shape this
 * simple are more legible as twenty lines of geometry than as binary blobs
 * nobody can review, and generating them keeps the only images in the
 * repository the ones that are evidence.
 *
 * `node build.mjs --watch` rebuilds on change, which is what `pnpm dev` runs.
 */
import { context, build } from 'esbuild'
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const dist = resolve(root, 'dist')
const watch = process.argv.includes('--watch')

/** Brand blue, and the lighter face of the ingot. Only used by the icon. */
const INK = [0x22, 0x27, 0x33, 0xff]
const FACE = [0x4f, 0x7c, 0xff, 0xff]
const TOP = [0x9a, 0xb6, 0xff, 0xff]

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

/** RGBA pixel buffer -> a PNG file. */
function encodePng(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Is (x, y) inside a rounded rectangle covering the whole unit square? */
function inRoundedSquare(x, y, size, radius) {
  const cx = Math.min(Math.max(x, radius), size - radius)
  const cy = Math.min(Math.max(y, radius), size - radius)
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
}

/** Is (x, y) inside the polygon? Even-odd crossing count. */
function inPolygon(x, y, points) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i]
    const [xj, yj] = points[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * An ingot: a trapezoid with a lighter top face, on a rounded dark square.
 *
 * Supersampled 3x in each axis, which is cheap at these sizes and is the
 * difference between a mark that reads at 16px and one that looks broken.
 */
function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const s = size / 128
  const radius = 26 * s
  const body = [
    [30 * s, 96 * s],
    [98 * s, 96 * s],
    [86 * s, 62 * s],
    [42 * s, 62 * s],
  ]
  const top = [
    [42 * s, 62 * s],
    [86 * s, 62 * s],
    [76 * s, 40 * s],
    [52 * s, 40 * s],
  ]
  const SS = 3

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let acc = [0, 0, 0, 0]
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const px = x + (sx + 0.5) / SS
          const py = y + (sy + 0.5) / SS
          let colour = [0, 0, 0, 0]
          if (inRoundedSquare(px, py, size, radius)) colour = INK
          if (inPolygon(px, py, body)) colour = FACE
          if (inPolygon(px, py, top)) colour = TOP
          for (let c = 0; c < 4; c += 1) acc[c] += colour[c]
        }
      }
      const at = (y * size + x) * 4
      for (let c = 0; c < 4; c += 1) rgba[at + c] = Math.round(acc[c] / (SS * SS))
    }
  }
  return encodePng(size, size, rgba)
}

async function writeIcons() {
  await mkdir(resolve(dist, 'icons'), { recursive: true })
  for (const size of [16, 48, 128]) {
    await writeFile(resolve(dist, 'icons', `icon-${size}.png`), drawIcon(size))
  }
}

async function copyStatic() {
  await cp(resolve(root, 'manifest.json'), resolve(dist, 'manifest.json'))
  await cp(resolve(root, 'src/options/options.html'), resolve(dist, 'options.html'))
  await cp(resolve(root, 'src/options/options.css'), resolve(dist, 'options.css'))
}

/** One esbuild config per JavaScript context. */
const bundles = [
  { entry: 'src/background/index.ts', outfile: 'background.js', format: 'esm' },
  { entry: 'src/content/index.ts', outfile: 'content.js', format: 'iife' },
  { entry: 'src/options/index.ts', outfile: 'options.js', format: 'esm' },
]

const shared = {
  bundle: true,
  target: ['chrome116'],
  platform: 'browser',
  logLevel: 'info',
  // Readable in `chrome://extensions` -> "service worker", which is where
  // anyone reviewing what this thing does will look first.
  minify: false,
}

async function run() {
  await rm(dist, { recursive: true, force: true })
  await mkdir(dist, { recursive: true })
  await writeIcons()
  await copyStatic()

  const configs = bundles.map((bundle) => ({
    ...shared,
    entryPoints: [resolve(root, bundle.entry)],
    outfile: resolve(dist, bundle.outfile),
    format: bundle.format,
  }))

  if (!watch) {
    await Promise.all(configs.map((config) => build(config)))
    console.log(`[ingot] extension built into ${dist}`)
    return
  }

  const contexts = await Promise.all(configs.map((config) => context(config)))
  await Promise.all(contexts.map((ctx) => ctx.watch()))
  console.log(`[ingot] watching; load ${dist} unpacked at chrome://extensions`)
}

await run()
