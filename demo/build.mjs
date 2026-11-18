// Builds the Mappy playground into one self-contained page: demo/dist/index.html.
//   npm install        (in this folder, once)
//   node build.mjs
// The widget's own source is bundled as it is; jimu-core is swapped for src/jimu-core.ts.
import { build } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
// --cdn: leave React out of the bundle and load it from cdnjs (smaller page; needs the network).
// --fragment: also write dist/fragment.html, the page without its html, head and body tags, for hosts that add their own.
const cdn = process.argv.includes('--cdn') || process.argv.includes('--fragment')
const LIBS = '<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>\n<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>\n'
// A hosted page (--fragment) may not offer file downloads: the save buttons are already hidden there
// (noDownloads), and this takes the unused download code out of the bundle as well.
const noDownloads = {
  name: 'no-downloads',
  setup (b) {
    b.onLoad({ filter: /ChatBubble\.tsx$/ }, args => {
      const src = readFileSync(args.path, 'utf8')
      const out = src.replace(/function download \(text: string, name: string, type: string\): void \{[\s\S]*?\n\}/, 'function download (text: string, name: string, type: string): void { }')
      if (out === src) throw new Error('demo/build.mjs: the download helper in ChatBubble.tsx was not found; update the no-downloads plugin.')
      return { contents: out, loader: 'tsx' }
    })
  }
}
const result = await build({
  plugins: process.argv.includes('--fragment') ? [noDownloads] : [],
  entryPoints: [resolve(here, 'src/main.tsx')],
  bundle: true,
  minify: !process.argv.includes('--readable'),
  write: false,
  format: 'iife',
  target: 'es2020',
  jsx: 'transform',
  // The widget's files take React from jimu-core, so classic JSX with React in scope (not the framework's emotion runtime).
  tsconfigRaw: { compilerOptions: { jsx: 'react', jsxFactory: 'React.createElement', jsxFragmentFactory: 'React.Fragment' } },
  define: { 'process.env.NODE_ENV': '"production"', DEMO_HOSTED: process.argv.includes('--fragment') ? 'true' : 'false' },
  alias: { 'jimu-core': resolve(here, 'src/jimu-core.ts'), ...(cdn ? { react: resolve(here, 'src/react-global.js'), 'react-dom': resolve(here, 'src/react-dom-global.js'), 'react-dom/client': resolve(here, 'src/react-dom-global.js') } : {}) },
  logLevel: 'warning'
})
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
const css = readFileSync(resolve(here, 'src/page.css'), 'utf8')
const html = readFileSync(resolve(here, 'src/page.html'), 'utf8').replace('/*CSS*/', () => css).replace('/*LIBS*/', () => cdn ? LIBS : '').replace('/*JS*/', () => js)
mkdirSync(resolve(here, 'dist'), { recursive: true })
writeFileSync(resolve(here, 'dist/index.html'), html)
console.log(`demo/dist/index.html ${(html.length / 1024).toFixed(0)} KB`)
if (process.argv.includes('--fragment')) {
  const fragment = `<title>Mappy Playground</title>\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@600;700&display=swap">\n<style>${css}</style>\n<div id="root"></div>\n${LIBS}<script>${js}</script>\n`
  writeFileSync(resolve(here, 'dist/fragment.html'), fragment)
  console.log(`demo/dist/fragment.html ${(fragment.length / 1024).toFixed(0)} KB`)
}
