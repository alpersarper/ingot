/**
 * The static docs site: the docs view, as one file that opens from `file://`.
 *
 * The approved export set calls for a shareable human face for a kit that needs
 * no server. The constraint that shapes this file is that it must not be a
 * *second* renderer: it renders `KitDocs` -- the same component the panel shows,
 * drawing the same canonical components the live preview draws -- to a static
 * string, and inlines the same two stylesheets. There is no static-site
 * framework here and no template duplicating the markup, because a template is
 * the thing that goes out of date.
 *
 * The output is self-contained by construction: no script, no network request,
 * no font file, no external stylesheet. The nav is anchors, which is why
 * `KitDocs` renders every component stacked when it is given no `onSelect`.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import type { TokensDocument } from '@ingot/engine'
import canonicalCss from '@/preview/canonical.css?raw'
import docsCss from '@/docs/docs.css?raw'
import { KitDocs } from '@/docs/KitDocs'
import { kitCssVariables } from '@/preview/kit-css'

/**
 * The only CSS in the export that is not the kit's own.
 *
 * Structure, not style: a box model, a page that fills the window, and images
 * that do not overflow. No colour, no size, no font -- those all come from the
 * kit through `canonical.css`.
 */
const RESET = `*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; min-height: 100%; }
img, svg { max-width: 100%; }
.ingot-kit-root { min-height: 100vh; }`

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * A custom-property value, made safe for the one `<style>` block this file has.
 *
 * Every value the engine emits is canonicalised, so nothing should ever trip
 * here -- the font stack is validated at its own parser for exactly this reason.
 * But this is the single export that inlines its stylesheet rather than linking
 * it, and the failure is silent: a value carrying `}` closes the rule and drops
 * the rest of `canonical.css` and `docs.css`, producing a page that opens, looks
 * merely unstyled, and reports nothing. A second guard at the boundary means no
 * future token kind can reopen that.
 */
function cssValue(value: string): string {
  return value.replace(/[{};<>\\]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** The kit's variables as a CSS rule rather than a 120-property style attribute. */
function variableRule(tokens: TokensDocument): string {
  const variables = kitCssVariables(tokens)
  const body = Object.keys(variables)
    .sort()
    .map((name) => `  ${name}: ${cssValue(variables[name] as string)};`)
    .join('\n')
  return `.ingot-kit-root {\n${body}\n}`
}

/**
 * Render the whole documentation site for one kit as a single HTML document.
 *
 * Deterministic: a pure function of the tokens document, with no clock in the
 * output, for the same reason `design.md` has none -- a timestamp would make
 * every regeneration a diff.
 */
export function renderDocsHtml(tokens: TokensDocument): string {
  const title = `${tokens.source.name} — kit documentation`
  const markup = renderToStaticMarkup(createElement(KitDocs, { tokens }))

  return [
    '<!doctype html>',
    `<html lang="en">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="generator" content="${escapeHtml(`${tokens.engine.name} ${tokens.engine.version}`)}">`,
    '<style>',
    RESET,
    variableRule(tokens),
    canonicalCss,
    docsCss,
    '</style>',
    '</head>',
    '<body>',
    `<div class="kit-surface ingot-kit-root">${markup}</div>`,
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

/** A filename a user can find again: the set id and the kit version. */
export function docsHtmlFilename(setId: string, version: number): string {
  return `${setId}-v${version}-docs.html`
}
