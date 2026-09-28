/**
 * The picker's stylesheet, as a string, so esbuild inlines it into the content
 * script and the extension ships one file per surface.
 *
 * It lives inside a shadow root and every rule is scoped there, which is the
 * only way an overlay survives a real page: the alternative is a class name
 * that a site's own CSS reaches, and the failure mode of that is an invisible
 * picker on exactly the sites worth capturing from.
 *
 * `:host { all: initial }` is the other half. Without it the host inherits the
 * page's font, colour and direction, and the overlay renders in whatever the
 * site decided -- which is both ugly and, on a dark site, unreadable.
 */
export const OVERLAY_CSS = `
:host {
  all: initial;
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  cursor: crosshair;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  color-scheme: dark;
}

:host([hidden]) { display: none; }

.halo {
  position: fixed;
  pointer-events: none;
  border: 2px solid #4f7cff;
  border-radius: 2px;
  box-shadow: 0 0 0 9999px rgba(8, 10, 18, 0.32), 0 0 0 1px rgba(255, 255, 255, 0.55);
  transition: top 40ms linear, left 40ms linear, width 40ms linear, height 40ms linear;
}

.halo[data-refused="true"] {
  border-color: #ff8a5b;
  box-shadow: 0 0 0 9999px rgba(8, 10, 18, 0.32), 0 0 0 1px rgba(255, 255, 255, 0.35);
}

/* A box a reader could not see is outlined in a dash rather than a solid rule:
   the outline still says "this is what you are pointing at" while looking
   unlike the confident one that means "this is a component". */
.halo[data-wrapper="true"] {
  border-style: dashed;
  border-color: #f0b429;
}

.chip {
  position: fixed;
  pointer-events: none;
  display: grid;
  gap: 1px;
  padding: 4px 8px;
  border-radius: 4px;
  background: #4f7cff;
  color: #ffffff;
  font-size: 11px;
  line-height: 16px;
  font-weight: 600;
  letter-spacing: 0.02em;
  max-width: min(420px, 90vw);
}

.chip[data-refused="true"] { background: #b94a1d; }

/* One claim per line, and each is a different kind of claim: what this is, what
   was measured to decide that, and whether it is a component at all. */
.chip .line {
  display: flex;
  gap: 8px;
  align-items: baseline;
  justify-content: space-between;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chip .dim { font-weight: 400; opacity: 0.85; }

.chip .warn {
  font-weight: 400;
  white-space: normal;
  color: #fff3d6;
  border-top: 1px solid rgba(255, 255, 255, 0.28);
  margin-top: 2px;
  padding-top: 2px;
}

.hint {
  position: fixed;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  pointer-events: none;
  padding: 8px 14px;
  border-radius: 999px;
  background: rgba(12, 14, 22, 0.92);
  color: #e9ecf5;
  font-size: 12px;
  line-height: 18px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
}

.hint kbd {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.14);
}

.sheet {
  position: fixed;
  width: 300px;
  max-width: calc(100vw - 24px);
  /* The last resort behind the placement clamp in picker.ts: on a short window
     even a perfectly placed popover can be taller than the viewport, and a Save
     button that has scrolled off the bottom of its own dialog is not a button. */
  max-height: calc(100vh - 24px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 14px;
  border-radius: 10px;
  background: #14171f;
  color: #e9ecf5;
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.5);
  font-size: 13px;
  line-height: 18px;
  display: grid;
  gap: 12px;
}

.sheet h1 {
  margin: 0;
  font-size: 13px;
  line-height: 18px;
  font-weight: 600;
}

.sheet .origin {
  margin: 0;
  font-size: 11px;
  line-height: 16px;
  color: #98a0b5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thumb {
  display: block;
  width: 100%;
  max-height: 120px;
  object-fit: contain;
  object-position: left center;
  border-radius: 6px;
  background: repeating-conic-gradient(#20242e 0% 25%, #1a1d26 0% 50%) 50% / 12px 12px;
}

.types {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
}

.types button {
  all: unset;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 8px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  font-size: 12px;
  line-height: 16px;
  cursor: pointer;
  color: #cbd2e2;
}

.types button:hover { border-color: rgba(255, 255, 255, 0.36); }
.types button:focus-visible { outline: 2px solid #4f7cff; outline-offset: 1px; }

.types button[aria-pressed="true"] {
  background: #4f7cff;
  border-color: #4f7cff;
  color: #ffffff;
  font-weight: 600;
}

/* The guess is marked, never pre-selected: a border says "probably this" while
   leaving the choice visibly unmade. */
.types button[data-guess="true"][aria-pressed="false"] { border-color: rgba(79, 124, 255, 0.85); }

.types .num {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  padding: 0 4px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.14);
  opacity: 0.9;
}

.actions { display: flex; gap: 8px; justify-content: flex-end; }

.actions button {
  all: unset;
  box-sizing: border-box;
  padding: 7px 14px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 16px;
  cursor: pointer;
}

.actions button:focus-visible { outline: 2px solid #4f7cff; outline-offset: 1px; }
.actions .cancel { color: #cbd2e2; border: 1px solid rgba(255, 255, 255, 0.16); }
.actions .save { background: #4f7cff; color: #ffffff; font-weight: 600; }

/* Save is disabled until a type is chosen, and it has to *look* disabled: a
   button that silently does nothing is worse than one that says it cannot. */
.actions .save:disabled {
  background: rgba(79, 124, 255, 0.3);
  color: rgba(255, 255, 255, 0.55);
  cursor: not-allowed;
}

.note {
  margin: 0;
  font-size: 11px;
  line-height: 16px;
  color: #98a0b5;
}

.note[data-tone="warn"] { color: #ffb08a; }
.note[data-tone="ask"] { color: #e9ecf5; }

.toast {
  position: fixed;
  left: 50%;
  bottom: 62px;
  transform: translateX(-50%);
  pointer-events: none;
  padding: 8px 14px;
  border-radius: 6px;
  background: #1b5e3a;
  color: #eafff2;
  font-size: 12px;
  line-height: 18px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
  /* A success toast is two words; a failure names the panel's own answer and
     what to do about it, and a sentence that cannot wrap is a sentence nobody
     reads. Wide enough to be read, bounded so it never covers the component. */
  max-width: min(620px, calc(100vw - 48px));
  text-align: center;
  text-wrap: pretty;
}

.toast[data-tone="error"] { background: #7a2716; color: #ffe8e0; }
`
