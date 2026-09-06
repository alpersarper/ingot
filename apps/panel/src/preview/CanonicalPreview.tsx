/**
 * The centre column: a small realistic screen, drawn with the user's kit.
 *
 * The approved panel skeleton makes this the main view for a reason -- the
 * user's real question is not "am I faithful to the capture" but "will my app
 * look good". So this is a sample UI rather than a swatch board, kept to the
 * four canonical component types this build ships.
 *
 * The whole thing is scoped by one element carrying the kit's CSS variables.
 * Nothing inside reaches for a panel colour, and nothing outside is affected.
 */
import type { ReactNode } from 'react'
import type { TokensDocument } from '@ingot/engine'
import { KitButton, KitCard, KitInput, KitTypeRow } from './components'
import { hasDestructive, kitCssVariables } from './kit-css'
import './canonical.css'

export function CanonicalPreview({ tokens }: { tokens: TokensDocument }): ReactNode {
  const variables = kitCssVariables(tokens) as Record<string, string>

  return (
    <div className="kit-surface h-full overflow-auto p-6 md:p-10" style={variables}>
      <div className="kit-stack mx-auto w-full max-w-3xl">
        <section className="kit-stack">
          <p className="kit-section-heading">Buttons</p>
          <div className="kit-row">
            <KitButton variant="primary">Publish kit</KitButton>
            <KitButton variant="secondary">Preview</KitButton>
            <KitButton variant="ghost">Cancel</KitButton>
            {/* No captured red means no destructive role, and so no destructive
                button. The engine refuses to invent a brand colour; drawing one
                here would put it back. */}
            {hasDestructive(tokens) ? <KitButton variant="destructive">Delete</KitButton> : null}
            <KitButton variant="primary" disabled>
              Disabled
            </KitButton>
          </div>
        </section>

        <section className="kit-stack">
          <p className="kit-section-heading">Cards and inputs</p>
          <div className="kit-grid">
            <KitCard
              title="Deploy preview"
              actions={
                <>
                  <KitButton variant="primary">Deploy</KitButton>
                  <KitButton variant="ghost">View log</KitButton>
                </>
              }
            >
              A card is a surface, a border and a radius. The engine emits no card recipe, so this one is composed
              from the scales rather than pretending to be measured.
            </KitCard>

            <KitCard title="Project settings">
              <div className="kit-stack">
                <KitInput label="Project name" defaultValue="Ingot" />
                <KitInput label="Domain" placeholder="ingot.example.com" hint="Used for preview links." />
                <KitInput label="Region" defaultValue="Locked" disabled />
              </div>
            </KitCard>
          </div>
        </section>

        <section className="kit-stack">
          <p className="kit-section-heading">Type scale</p>
          <KitCard title="Typography">
            <div>
              {tokens.typography.steps.map((step) => (
                <KitTypeRow key={step.value.name} step={step.value} />
              ))}
            </div>
          </KitCard>
        </section>
      </div>
    </div>
  )
}
