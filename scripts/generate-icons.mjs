/**
 * Generates the PWA icons from the same vector description as public/icon.svg.
 *
 * Written as a zero-dependency PNG encoder rather than pulling in sharp or a
 * headless browser: the icons are committed, so this only runs when the mark
 * itself changes, and a build dependency for that is not worth carrying.
 *
 *   npm run icons
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(HERE, '../public/icons')

const NAVY = [15, 23, 42]
const WHITE = [255, 255, 255]

/** Rendered at 4x and box-filtered down, which is enough to hide the jaggies. */
const SUPERSAMPLE = 4

// --- PNG encoding -----------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = -1
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  }
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([length, typeAndData, crc])
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // colour type: RGBA
  header[10] = 0 // deflate
  header[11] = 0 // adaptive filtering
  header[12] = 0 // no interlace

  // One filter byte per scanline; filter type 0 (None) keeps this simple and
  // still compresses well for flat-colour artwork.
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// --- the mark ---------------------------------------------------------------

/**
 * Shapes in a 0..1 unit square, so one description renders at any size.
 * `inset` shrinks the artwork for maskable icons, which are cropped to a circle.
 */
function shapes(inset) {
  const scale = (v) => 0.5 + (v - 0.5) * inset

  return [
    // cargo box
    { kind: 'rect', x0: scale(0.12), x1: scale(0.55), y0: scale(0.34), y1: scale(0.61), color: WHITE },
    // cab
    { kind: 'rect', x0: scale(0.58), x1: scale(0.84), y0: scale(0.43), y1: scale(0.61), color: WHITE },
    // windscreen
    { kind: 'rect', x0: scale(0.64), x1: scale(0.80), y0: scale(0.46), y1: scale(0.53), color: NAVY },
    // wheels
    { kind: 'circle', cx: scale(0.27), cy: scale(0.655), r: 0.082 * inset, color: WHITE },
    { kind: 'circle', cx: scale(0.27), cy: scale(0.655), r: 0.034 * inset, color: NAVY },
    { kind: 'circle', cx: scale(0.71), cy: scale(0.655), r: 0.082 * inset, color: WHITE },
    { kind: 'circle', cx: scale(0.71), cy: scale(0.655), r: 0.034 * inset, color: NAVY },
    // road
    { kind: 'rect', x0: scale(0.10), x1: scale(0.90), y0: scale(0.755), y1: scale(0.785), color: WHITE },
  ]
}

/** Signed distance to a rounded rectangle, used to round the icon corners. */
function insideRoundedRect(x, y, radius) {
  const dx = Math.max(radius - x, 0, x - (1 - radius))
  const dy = Math.max(radius - y, 0, y - (1 - radius))
  return Math.hypot(dx, dy) <= radius
}

function sample(x, y, items, cornerRadius) {
  if (cornerRadius > 0 && !insideRoundedRect(x, y, cornerRadius)) {
    return null // transparent outside the rounded square
  }

  let color = NAVY
  for (const item of items) {
    if (item.kind === 'rect') {
      if (x >= item.x0 && x <= item.x1 && y >= item.y0 && y <= item.y1) color = item.color
    } else if (Math.hypot(x - item.cx, y - item.cy) <= item.r) {
      color = item.color
    }
  }
  return color
}

function render(size, { inset = 1, cornerRadius = 0.18 } = {}) {
  const items = shapes(inset)
  const rgba = Buffer.alloc(size * size * 4)
  const step = 1 / (size * SUPERSAMPLE)

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0

      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = (px * SUPERSAMPLE + sx + 0.5) * step
          const y = (py * SUPERSAMPLE + sy + 0.5) * step
          const color = sample(x, y, items, cornerRadius)
          if (color) {
            r += color[0]
            g += color[1]
            b += color[2]
            a += 255
          }
        }
      }

      const samples = SUPERSAMPLE * SUPERSAMPLE
      const offset = (py * size + px) * 4
      // Premultiplied averaging would darken the edge; averaging only the
      // covered samples keeps the anti-aliased rim the right colour.
      const covered = a / 255
      if (covered > 0) {
        rgba[offset] = Math.round(r / covered)
        rgba[offset + 1] = Math.round(g / covered)
        rgba[offset + 2] = Math.round(b / covered)
      }
      rgba[offset + 3] = Math.round(a / samples)
    }
  }

  return encodePng(size, size, rgba)
}

mkdirSync(OUT_DIR, { recursive: true })

const targets = [
  ['icon-192.png', render(192)],
  ['icon-512.png', render(512)],
  // Maskable icons get cropped to a circle by the launcher, so the artwork is
  // pulled into the middle 80% and the background covers the full square.
  ['icon-512-maskable.png', render(512, { inset: 0.8, cornerRadius: 0 })],
]

for (const [name, buffer] of targets) {
  writeFileSync(resolve(OUT_DIR, name), buffer)
  console.log(`${name}  ${(buffer.length / 1024).toFixed(1)} KB`)
}
