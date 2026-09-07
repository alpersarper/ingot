/**
 * The kit documentation: a browsable component library, set in the kit itself.
 *
 * One implementation, two surfaces. In the panel it is a nav plus the selected
 * component; in the static export it is the same nav as anchors plus every
 * component stacked, so the exported file opens from `file://` with no server
 * and no script. Both render the same {@link DocsSection}, which renders the
 * same canonical components the live preview uses -- which is the whole point:
 * a docs page that drew its own approximation of a button would document a
 * button nobody ships.
 *
 * Everything on the page comes from the engine's `ComponentDoc`: the prose, the
 * token table, the colours, the rules and the prohibitions. Nothing is written
 * twice, so the in-panel docs, the static export and the per-component markdown
 * cannot disagree.
 */
import type { ReactNode } from 'react'
import { componentDocs } from '@ingot/engine'
import type { ComponentDoc, ComponentDocId, TokensDocument } from '@ingot/engine'
import { ComponentGallery } from '@/preview/gallery'
import './docs.css'

/** How each origin is worded. The same words the markdown export uses. */
const ORIGIN_LABEL: Record<string, string> = {
  observed: 'measured',
  derived: 'derived',
  filled: 'engine default',
  adjusted: 'contrast-adjusted',
  overridden: 'user override',
}

export interface KitDocsProps {
  tokens: TokensDocument
  /** The component on screen. Ignored when `onSelect` is absent. */
  active?: ComponentDocId
  /**
   * Present in the panel, absent in the static export.
   *
   * Its absence is what switches this from "a nav that selects" to "a nav of
   * anchors over every component", which is the form that needs no JavaScript.
   */
  onSelect?: (id: ComponentDocId) => void
  /**
   * True when the palette on screen was computed in the panel rather than
   * distilled -- the counterpart theme.
   *
   * The page may not then claim that every value on it came from the kit,
   * because the surface and text roles did not: they were flipped, re-spread
   * and re-enforced here. The export never sets it; the kit ships in the mode
   * it was distilled in.
   */
  derivedPalette?: boolean
}

export function KitDocs({ tokens, active, onSelect, derivedPalette = false }: KitDocsProps): ReactNode {
  const docs = componentDocs(tokens)
  const current = docs.find((doc) => doc.id === active) ?? docs[0]
  const shown = onSelect === undefined ? docs : current === undefined ? [] : [current]

  return (
    <div className="kit-docs">
      <nav className="kit-docs-nav" aria-label="Components">
        <p className="kit-docs-nav-title">{tokens.source.name}</p>
        {docs.map((doc) =>
          onSelect === undefined ? (
            <a key={doc.id} className="kit-docs-link" href={`#component-${doc.id}`}>
              {doc.title}
            </a>
          ) : (
            <button
              key={doc.id}
              type="button"
              className="kit-docs-link"
              aria-current={doc.id === current?.id ? 'true' : undefined}
              onClick={() => onSelect(doc.id)}
            >
              {doc.title}
            </button>
          ),
        )}
      </nav>

      <main className="kit-docs-main">
        {onSelect === undefined ? (
          <div className="kit-docs-lede">
            <h1 className="kit-docs-heading">{tokens.source.name}</h1>
            <p className="kit-docs-summary">
              {tokens.source.description} Distilled by {tokens.engine.name} {tokens.engine.version} from{' '}
              {tokens.source.captureCount} captured components.{' '}
              {derivedPalette
                ? `This is the ${tokens.color.mode}-mode counterpart, derived in the panel: the surface and text roles below were computed here and are marked derived, and the kit itself is not exported in this mode.`
                : 'Every value on this page comes from that kit; this page is set in it.'}
            </p>
          </div>
        ) : (
          derivedPalette ? (
            <div className="kit-docs-lede">
              <p className="kit-docs-summary">
                This is the {tokens.color.mode}-mode counterpart, derived in the panel. The surface and text roles
                below were computed here rather than measured, and the kit exports in its own mode.
              </p>
            </div>
          ) : null
        )}

        {shown.map((doc) => (
          <DocsSection key={doc.id} doc={doc} tokens={tokens} />
        ))}

        <p className="kit-docs-footer">
          Origins are stated per value: <em>measured</em> came from the captures, <em>derived</em> follows from
          another token, <em>engine default</em> is a sanctioned value the engine supplied because nothing described
          that control, and <em>user override</em> was set by hand. Full provenance for every token is in{' '}
          <code>tokens.json</code>.
        </p>
      </main>
    </div>
  )
}

/** One component's page. Identical in the panel and in the static export. */
export function DocsSection({ doc, tokens }: { doc: ComponentDoc; tokens: TokensDocument }): ReactNode {
  return (
    <section className="kit-docs-section" id={`component-${doc.id}`} aria-labelledby={`heading-${doc.id}`}>
      <div className="kit-docs-block">
        <h2 className="kit-docs-heading" id={`heading-${doc.id}`}>
          {doc.title}
        </h2>
        <p className="kit-docs-summary">{doc.summary}</p>
      </div>

      <div className="kit-docs-stage">
        <ComponentGallery doc={doc} tokens={tokens} />
      </div>

      {doc.tokens.length === 0 ? null : (
        <div className="kit-docs-block">
          <h3 className="kit-docs-subheading">Values</h3>
          <div className="kit-scroll">
            <table className="kit-table">
              <thead>
                <tr>
                  <th scope="col">Value</th>
                  <th scope="col">Set to</th>
                  <th scope="col">Token</th>
                  <th scope="col">Origin</th>
                </tr>
              </thead>
              <tbody>
                {doc.tokens.map((row) => (
                  <tr key={row.path}>
                    <td>{row.label}</td>
                    <td>{row.resolved === undefined ? row.value : `${row.value} (${row.resolved})`}</td>
                    <td>
                      <span className="kit-docs-mono">{row.path}</span>
                    </td>
                    <td>
                      <span className="kit-docs-origin" data-origin={row.origin}>
                        {ORIGIN_LABEL[row.origin] ?? row.origin}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {doc.colors.length === 0 ? null : (
        <div className="kit-docs-block">
          <h3 className="kit-docs-subheading">Colours</h3>
          <div className="kit-scroll">
            <table className="kit-table">
              <thead>
                <tr>
                  <th scope="col">Where</th>
                  <th scope="col">Role</th>
                  <th scope="col">Value</th>
                  <th scope="col">Origin</th>
                </tr>
              </thead>
              <tbody>
                {doc.colors.map((row) => (
                  <tr key={`${row.label}-${row.role ?? 'none'}`}>
                    <td>{row.label}</td>
                    <td>
                      <span className="kit-docs-mono">{row.role ?? 'none — transparent'}</span>
                    </td>
                    <td>
                      {row.hex === null ? (
                        <span className="kit-docs-mono">transparent</span>
                      ) : (
                        <>
                          <span className="kit-docs-swatch" style={{ background: row.hex }} aria-hidden />{' '}
                          <span className="kit-docs-mono">{row.hex}</span>
                        </>
                      )}
                    </td>
                    <td>
                      {row.origin === null ? (
                        <span className="kit-docs-mono">—</span>
                      ) : (
                        <span className="kit-docs-origin" data-origin={row.origin}>
                          {ORIGIN_LABEL[row.origin] ?? row.origin}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="kit-docs-block">
        <h3 className="kit-docs-subheading">Rules</h3>
        <ul className="kit-docs-list">
          {doc.usage.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </div>

      <div className="kit-docs-block">
        <h3 className="kit-docs-subheading">Do not</h3>
        <ul className="kit-docs-list" data-tone="do-not">
          {doc.doNot.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}
