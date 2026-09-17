# Decision register

Settled decisions that constrain future work on Ingot: what was decided, why, and
what it forbids or requires. Read this at session start alongside
[AGENTS.md](AGENTS.md), which owns day-to-day conventions (commands,
non-negotiables as enforced by tests, heuristic-change workflow). This file is
the *why*; AGENTS.md is the *how*. Don't duplicate across them — link.

Add an entry whenever a choice constrains work beyond the commit that makes it.
Reversals edit the entry in place rather than appending a contradiction; git
history owns the chronology.

## Product identity

- **Ingot is a distillation workbench, not a one-click extractor.** The field is
  crowded with extractors; the bet is cross-site distillation *quality*.
  Requires: features are judged by whether they make one coherent kit out of
  many sites, not by capture convenience.
- **Audience is indie developers shipping with LLMs.** No designer/developer
  split, no two-audience UI.
- **The panel is the product, not an export utility.** Review and override are
  the experience. Forbids treating override as an escape hatch or a debug view.
- **Curation is the primary journey: collect, curate, distil.** The **library**
  is the type-agnostic pool every capture lands in. **Groups** are named
  curations within it and are **non-exclusive** — a capture may be in several,
  because deciding which captures belong together is the work, and a capture
  that can only be in one place makes that decision unrepeatable. A kit
  generates from a **scope**: the whole library, a group, or an ad-hoc
  selection. Requires: multi-select is a first-class verb of the collection
  column, and groups are objects there (open, rename, delete) rather than
  filters. Forbids a "move to group" that takes a capture out of another, and
  forbids an import being the only way a group can exist.

## Hard boundaries (v1 scope)

- **Capture is reference-grade** — screenshot, computed styles, URL — never
  reproduction-grade. Forbids DOM cloning or anything aiming at pixel replay.
- **Deterministic engine first; LLM only for judgment** (naming, suggestions,
  rationale, Q&A). The engine stays pure and byte-identical; see AGENTS.md.
- **Four component types** (button, card, input, typography) until v1 ships. A
  fifth is a post-v1 decision, not a PR-sized one.
- **Decisive but overridable.** The engine picks a dominant direction and states
  its reasoning; the user's override is the product. Forbids "we couldn't
  decide" output.
- **Everything token-driven.** A theme change is a token swap and preview, docs
  and exports turn together with it.
- **One engine, three surfaces.** One canonical renderer drives live preview,
  in-panel docs and static docs export. Forbids a second render path or a second
  copy of the prose.
- **Export set is fixed for v1:** `tokens.json` (source of truth), a
  whole-library `design.md` (Tailwind + shadcn target), self-sufficient
  per-component markdown, and a standalone static docs site.
- **Out of scope for v1:** accounts/sync, teams, working-code reproduction,
  Figma, auto-clustering, Firefox/Safari.

## Quality bar

- **"Would I ship this?" applies to the three coherent fixture sets** —
  `linear-dark`, `stripe-light`, `ghost-warm`. `messy-mixed` is a smoke test,
  judged only on degrading legibly and warning loudly. Forbids tuning that
  trades coherent-set quality for messy-set numbers.
- **Minimum capture threshold.** No kit from too few captures; intent-only
  (capture-less) generation is out.
- **Blind-LLM acceptance loop.** `design.md` handed to an LLM with no other
  context must yield ship-quality UI. That run, not unit tests, is the bar a
  major engine change is measured against.
- **A kit's error state clears the bar with *either* a destructive colour or a
  recorded acknowledgment.** Quality run #2 (2026-09-12) put the bar and the
  no-invented-brand-colour law in direct tension on `linear-dark`: a kit with no
  red and an explicit prohibition on adding one cannot draw a shippable billing
  form, so the bar as written was unreachable for that fixture. The ruling keeps
  the law untouched and moves the workbench: the absence is surfaced with its
  concrete consequence, and the reviewer either supplies a colour or
  acknowledges shipping without one. Requires: a kit with neither is measured as
  *unresolved* rather than as passing. Forbids: satisfying the bar by capturing
  a red into a fixture instead of answering the question, and hard-blocking
  export on an unresolved kit — the card and the kit status stay visibly open.

## Curation and kit lifecycle

- **A selection kit versions and reviews in the library's lineage.** Generating
  from an ad-hoc selection makes a kit with `scope: 'selection'`, which takes the
  next *library* version and carries the *library* scope's review state. The two
  candidates were a lineage of its own and the library's; the library's wins
  because review state keys on a scope, and a selection has no identity for one
  to key on — an override filed under "these six ids" is a decision the user can
  never reach again, which is the silent loss the whole override machinery
  exists to prevent. A reviewer who wants a lineage of their own groups the
  selection, which is one click away in the same bar. Requires: a selection kit
  states that it is a one-off, and says that overrides made on it stand for the
  library. Forbids inferring "selection" from `captureIds` instead of storing
  the scope, and forbids a fourth review scope.
- **A selection is a set, not an order.** The same captures ticked in any order
  produce byte-identical output: the server orders a selection by the library's
  own insertion sequence, never by the order the ids arrived in. Forbids letting
  click order reach the engine.
- **Kit history is append-only; a library reset is the single exception.**
  Regenerating adds a version, and deleting a group *orphans* its kits rather
  than deleting them, so a document somebody exported never loses the record of
  what produced it. `POST /api/reset` is the one path that destroys a kit, and
  it is gated on a confirmation word the API itself checks rather than on a
  dialog alone. Pairing and the stored key survive it — starting a library over
  is not re-pairing. Forbids a second delete path into kits, and forbids a
  destructive action whose dialog does not name exactly what goes and what
  stays.

## Architecture

- **pnpm monorepo:** `packages/engine` (pure core), `apps/server` (Node/TS,
  SQLite behind a storage interface, images on disk), `apps/panel` (React + Vite
  + Tailwind + shadcn). One container, one port (4310), one volume.
- **Storage is an interface, not SQLite.** Postgres later must be an adapter
  swap plus contract-suite cases — never a call-site change. See
  [docs/storage.md](docs/storage.md).
- **The extension (phase 3, unbuilt) pairs over a configurable server address
  with a pairing token** and buffers captures in-extension while the panel is
  down. Forbids assuming co-location or a fixed origin.
- **Build order: core → panel → extension last.**

## Security & keys

- **The LLM API key is server-side only and write-only.** No endpoint returns
  it, it is redacted from logs (tested), and LLM endpoints are pairing-gated and
  rate-limited.
- **No encryption at rest for the key**, stated honestly in the docs: there is
  no user password to derive from. Revisit when hosted or multi-user. Forbids
  implying encryption we don't do.
- **The README says exactly what leaves the machine.**

## LLM assistant

- **BYOK Anthropic key for v1.** An API key is not a claude.ai subscription;
  first run must guide a keyless user rather than failing opaquely.
- **The assistant never writes tokens.** Proposals pass engine-guardrail
  validation, surface as proposal cards, and become values only through the
  override machinery, with distinct `llm-suggested` provenance.
- **One narrow `LlmClient` interface**, sole v1 implementation the official
  Anthropic SDK; typed capability operations with versioned in-code prompts and
  structured-output schemas.
- **Multi-LLM is deferred as a bounded seam, not debt.** An
  OpenAI-compatible endpoint type will cover the rest. The Vercel AI SDK was
  evaluated and not adopted for v1; re-evaluate at pickup. The interface is the
  contract that keeps the deferral bounded.

## Law (settled rulings — change these only by an explicit new ruling)

- **Three documents, three questions.** `pristine`, `baseline` and `effective`
  are distinct types: provenance reads pristine, conflict determination reads
  baseline, rendering and exports read effective.
- **Conflict determination is engine-owned.** `applyOverrides` returns
  conflicts, retirements and convergences; routes and exports only persist and
  state them. A caller that works out a conflict of its own is the defect this
  seam exists to prevent.
- **Nothing retires silently.** When the engine later agrees with a standing
  override, it reports "now agrees" once.
- **Labels match truth.** Derived is never presented as measured; per-field
  override records are the single source of truth for type-step provenance.
- **Overrides survive regeneration** (contract). Surviving delete-and-reimport
  was declined as scope expansion.
- **Overriding a base colour re-derives dependent shades** and re-runs
  contrast/collapse checks; an explicit user override on a dependent always wins.
- **One rule source per behaviour.** Per-component markdown is self-sufficient
  and must agree with `design.md` and the preview.
- **A conflict retires only when the reviewer responds** — a value change or a
  card action. Note-only edits touch nothing; retirements are recorded in
  provenance.
- **Spacing step names are opaque stable identifiers**, and `design.md` never
  asserts a blanket claim the shipped values contradict.
- **Reviewer-authored reasons are never silently blanked**; a standing reason
  carries forward when a write supplies none.
- **No literal visual values outside tokens, anywhere** — fallbacks fall back to
  kit tokens.
- **The engine never invents a brand colour; a reviewer may supply one.**
  `color.roles.destructive` is an overridable slot even where the kit has none.
  Nominating a colour makes the engine finish the job — foreground, contrast
  pairs, destructive button — through the functions `distill` already uses.
  Forbids a second write path, and forbids the engine ever writing
  `components.states.error.mode: acknowledged`.
- **Shipping without an error colour is informed consent, not a default.** Only
  a person may write `acknowledged`, and only after the kit has stated the
  consequence. It is an ordinary override, so it is durable provenance, survives
  regeneration, and retires only by user action; when a later capture set
  supplies a red the engine's answer moves and the standing conflict machinery
  reports the disagreement. The assistant may propose the *colour* and is
  refused the *decision* — a consent card a reviewer clicked through on the
  assistant's suggestion would not be consent.
- **A state is collapsed when a reader cannot see it, not when two hexes
  match.** Perceptibility floors are measured against the rendered colours, and
  the derivation spends chroma to restore a state before the diagnostic
  concedes it. Forbids reintroducing an equality test as a proxy.
