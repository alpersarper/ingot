/**
 * The live gallery: one component, every variant, every state.
 *
 * This is the bridge between the engine's `ComponentDoc` -- which says what a
 * component is and which tokens it uses -- and the canonical components, which
 * draw it. It is the piece that makes "one engine, three surfaces" true: the
 * in-panel docs render this, the static docs export renders this, and the live
 * preview composes the same components into a screen.
 *
 * Nothing here chooses a colour or a size. It chooses *what to show*, which is
 * an editorial decision about documentation, not a styling one.
 */
import type { ReactNode } from 'react'
import type { ComponentDoc, TokensDocument } from '@ingot/engine'
import {
  KitBadge,
  KitButton,
  KitCard,
  KitInput,
  KitSelect,
  KitSpecimen,
  KitStat,
  KitTable,
  KitTypeRow,
} from './components'
import type { KitButtonVariant, KitForcedState } from './components'
import { hasDestructive } from './kit-css'

/** The states a control is documented in, in the order a reader expects. */
const CONTROL_STATES: Array<{ label: string; state?: KitForcedState; disabled?: boolean }> = [
  { label: 'Default' },
  { label: 'Hover', state: 'hover' },
  { label: 'Pressed', state: 'active' },
  { label: 'Focus', state: 'focus' },
  { label: 'Disabled', disabled: true },
]

export function ComponentGallery({ doc, tokens }: { doc: ComponentDoc; tokens: TokensDocument }): ReactNode {
  switch (doc.id) {
    case 'button':
      return <ButtonGallery tokens={tokens} />
    case 'input':
      return <InputGallery />
    case 'select':
      return <SelectGallery />
    case 'card':
      return <CardGallery />
    case 'badge':
      return <BadgeGallery tokens={tokens} />
    case 'table':
      return <TableGallery tokens={tokens} />
    case 'typography':
      return <TypographyGallery tokens={tokens} />
    default:
      return null
  }
}

function buttonVariants(tokens: TokensDocument): KitButtonVariant[] {
  const variants: KitButtonVariant[] = ['primary', 'secondary', 'ghost']
  // No captured red means no destructive role, so no destructive button. The
  // engine refuses to invent a brand colour; drawing one here would put it back.
  if (hasDestructive(tokens)) variants.push('destructive')
  return variants
}

const BUTTON_LABEL: Record<KitButtonVariant, string> = {
  primary: 'Publish kit',
  secondary: 'Preview',
  ghost: 'Cancel',
  destructive: 'Delete',
}

function ButtonGallery({ tokens }: { tokens: TokensDocument }): ReactNode {
  return (
    <div className="kit-stack">
      {buttonVariants(tokens).map((variant) => (
        <KitSpecimen key={variant} label={variant}>
          {CONTROL_STATES.map((entry) => (
            <KitButton
              key={entry.label}
              variant={variant}
              state={entry.state}
              disabled={entry.disabled === true}
              title={entry.label}
            >
              {BUTTON_LABEL[variant]}
            </KitButton>
          ))}
        </KitSpecimen>
      ))}
      <p className="kit-hint">
        Left to right: default, hover, pressed, focus, disabled. The hover and pressed samples are drawn with the
        same declarations the live control uses, not an approximation of them.
      </p>
    </div>
  )
}

function InputGallery(): ReactNode {
  return (
    <div className="kit-grid">
      <div className="kit-stack-tight">
        <KitInput label="Project name" defaultValue="Ingot" id="doc-input-default" />
        <KitInput
          label="Domain"
          placeholder="ingot.example.com"
          hint="Used for preview links."
          id="doc-input-hint"
        />
        <KitInput label="Focus" defaultValue="Focused" state="focus" id="doc-input-focus" />
      </div>
      <div className="kit-stack-tight">
        <KitInput label="Hover" defaultValue="Hovered" state="hover" id="doc-input-hover" />
        <KitInput
          label="Billing email"
          defaultValue="not-an-email"
          error="Enter an email address such as name@example.com."
          id="doc-input-error"
        />
        <KitInput label="Region" defaultValue="Locked" disabled id="doc-input-disabled" />
      </div>
    </div>
  )
}

const REGIONS = ['Europe (Frankfurt)', 'US East (Virginia)', 'Asia Pacific (Sydney)']

function SelectGallery(): ReactNode {
  return (
    <div className="kit-grid">
      <div className="kit-stack-tight">
        <KitSelect label="Region" options={REGIONS} id="doc-select-default" />
        <KitSelect
          label="Plan"
          options={['Starter', 'Team', 'Enterprise']}
          hint="Changing this takes effect next cycle."
          id="doc-select-hint"
        />
        <KitSelect label="Focus" options={REGIONS} state="focus" id="doc-select-focus" />
      </div>
      <div className="kit-stack-tight">
        <KitSelect label="Hover" options={REGIONS} state="hover" id="doc-select-hover" />
        <KitSelect
          label="Currency"
          options={['Choose one', 'EUR', 'USD']}
          error="Pick a currency before continuing."
          id="doc-select-error"
        />
        <KitSelect label="Locked" options={['Europe (Frankfurt)']} disabled id="doc-select-disabled" />
      </div>
    </div>
  )
}

function CardGallery(): ReactNode {
  return (
    <div className="kit-grid">
      <KitCard title="Deploy preview" meta="Updated 4 minutes ago">
        A card is a surface, a border and a radius. The engine emits no card recipe, so this one is composed from
        the scales rather than pretending to be measured.
      </KitCard>
      <KitCard
        title="Danger zone"
        actions={
          <>
            <KitButton variant="secondary">Transfer</KitButton>
            <KitButton variant="ghost">Cancel</KitButton>
          </>
        }
      >
        Actions sit at the foot of the card, in a row, separated by the same step that separates the card&rsquo;s own
        blocks.
      </KitCard>
    </div>
  )
}

function BadgeGallery({ tokens }: { tokens: TokensDocument }): ReactNode {
  return (
    <div className="kit-stack">
      <KitSpecimen label="default">
        <KitBadge>Paid</KitBadge>
        <KitBadge>Pending</KitBadge>
        <KitBadge>Refunded</KitBadge>
      </KitSpecimen>
      {hasDestructive(tokens) ? (
        <KitSpecimen label="destructive">
          <KitBadge tone="destructive">Failed</KitBadge>
          <KitBadge tone="destructive">Expired</KitBadge>
        </KitSpecimen>
      ) : (
        <p className="kit-hint">
          This kit has no destructive colour, so it has no destructive badge. Every status is told apart by its
          word.
        </p>
      )}
    </div>
  )
}

const TABLE_COLUMNS = [
  { key: 'invoice', label: 'Invoice' },
  { key: 'customer', label: 'Customer' },
  { key: 'status', label: 'Status' },
  { key: 'amount', label: 'Amount', numeric: true },
]

function TableGallery({ tokens }: { tokens: TokensDocument }): ReactNode {
  const failed = hasDestructive(tokens) ? (
    <KitBadge tone="destructive">Failed</KitBadge>
  ) : (
    <KitBadge>Failed</KitBadge>
  )
  return (
    <div className="kit-stack">
      <div className="kit-scroll">
        <KitTable
          columns={TABLE_COLUMNS}
          caption="Third row is drawn hovered, fourth is drawn selected."
          rows={[
            {
              key: 'a',
              cells: { invoice: 'INV-2041', customer: 'Northwind', status: <KitBadge>Paid</KitBadge>, amount: '€1,280.00' },
            },
            {
              key: 'b',
              cells: { invoice: 'INV-2040', customer: 'Contoso', status: <KitBadge>Pending</KitBadge>, amount: '€460.00' },
            },
            {
              key: 'c',
              hovered: true,
              cells: { invoice: 'INV-2039', customer: 'Fabrikam', status: failed, amount: '€2,015.50' },
            },
            {
              key: 'd',
              selected: true,
              cells: { invoice: 'INV-2038', customer: 'Tailspin', status: <KitBadge>Paid</KitBadge>, amount: '€312.00' },
            },
          ]}
        />
      </div>
    </div>
  )
}

function TypographyGallery({ tokens }: { tokens: TokensDocument }): ReactNode {
  return (
    <div className="kit-stack-tight">
      {tokens.typography.steps.map((step) => (
        <KitTypeRow key={step.value.name} step={step.value} />
      ))}
    </div>
  )
}

/**
 * The sample screen: the kit applied to something that looks like a product.
 *
 * The approved panel skeleton makes this the main view for a reason -- the
 * user's real question is not "am I faithful to the capture" but "will my app
 * look good". So the centre column is a screen, built out of the same canonical
 * components the docs pages document one at a time.
 */
export function SampleScreen({ tokens }: { tokens: TokensDocument }): ReactNode {
  return (
    <div className="kit-page">
      <header className="kit-header">
        <div className="kit-stack-tight">
          <h1 className="kit-page-title">Payments</h1>
          <p className="kit-page-lede">Everything on this screen is drawn from your kit&rsquo;s tokens.</p>
        </div>
        <div className="kit-row">
          <KitButton variant="secondary">Export</KitButton>
          <KitButton variant="primary">New invoice</KitButton>
        </div>
      </header>

      <div className="kit-grid-stats">
        <KitStat label="Collected" value="€48,210" hint="+12% on last month" />
        <KitStat label="Outstanding" value="€6,940" hint="9 invoices" />
        <KitStat label="Failed" value="€2,015" hint="1 invoice" />
        <KitStat label="Refunded" value="€312" hint="1 invoice" />
      </div>

      <div className="kit-stack-tight">
        <p className="kit-section-heading">Recent invoices</p>
        <KitCard title="This month">
          <TableGallery tokens={tokens} />
        </KitCard>
      </div>

      <div className="kit-grid">
        <KitCard
          title="Billing details"
          actions={
            <>
              <KitButton variant="primary">Save changes</KitButton>
              <KitButton variant="ghost">Discard</KitButton>
            </>
          }
        >
          <div className="kit-stack-tight">
            <KitInput label="Company" defaultValue="Ingot GmbH" id="sample-company" />
            <KitInput
              label="Billing email"
              defaultValue="not-an-email"
              error="Enter an email address such as name@example.com."
              id="sample-email"
            />
            <KitSelect label="Region" options={REGIONS} hint="Where invoices are issued from." id="sample-region" />
          </div>
        </KitCard>

        <div className="kit-stack">
          <KitCard title="Controls">
            <div className="kit-stack">
              <ButtonGallery tokens={tokens} />
            </div>
          </KitCard>
          <KitCard title="Type scale">
            <TypographyGallery tokens={tokens} />
          </KitCard>
        </div>
      </div>
    </div>
  )
}
