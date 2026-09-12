/**
 * Turns the built demo into a page that can be published as an Artifact.
 *
 * The hosting wraps the file it is given in its own `<!doctype html><head>…`
 * skeleton, so a full document would end up nested inside another one. This
 * rewrites Vite's `index.html` into the fragment that belongs in a body:
 * the title, the stylesheet link, `#root`, and the module script — in that
 * order, unchanged otherwise.
 *
 * Written as a build step rather than a hand-edited copy so the asset hashes
 * can never drift from the bundle they name.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const dist = path.resolve(import.meta.dirname, '..', 'dist')
const source = path.join(dist, 'index.html')
const target = path.join(dist, 'demo.html')

const html = await readFile(source, 'utf8')

const fragment = html
  // The skeleton supplies the document, the charset and the viewport.
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<\/?(?:html|head|body)[^>]*>\s*/gi, '')
  .replace(/<meta\s+charset[^>]*>\s*/gi, '')
  .replace(/<meta\s+name="viewport"[^>]*>\s*/gi, '')
  // Same-origin requests need no CORS mode, and dropping it removes one way
  // for the hosting to refuse an asset.
  .replace(/\s+crossorigin(?=[\s>])/g, '')
  .split('\n')
  .map((line) => line.trimEnd())
  .filter((line) => line.trim().length > 0)
  .map((line) => line.replace(/^ {4}/, ''))
  .join('\n')

if (!/<div id="root">/.test(fragment)) {
  throw new Error('dist/index.html has no #root — did the build change?')
}
if (!/<script[^>]+type="module"/.test(fragment)) {
  throw new Error(
    'dist/index.html references no module script — the build is not linked',
  )
}
if (/\ssrc="\//.test(fragment) || /\shref="\//.test(fragment)) {
  throw new Error(
    'dist/index.html still has root-relative asset paths; build with VITE_DEMO=1 so base is "./"',
  )
}

await writeFile(target, `${fragment}\n`, 'utf8')
console.log(`wrote ${path.relative(process.cwd(), target)}`)
console.log(fragment)
