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

.chip {
  position: fixed;
  pointer-events: none;
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 4px 8px;
  border-radius: 4px;
  background: #4f7cff;
  color: #ffffff;
  font-size: 11px;
  line-height: 16px;
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
  max-width: 90vw;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chip[data-refused="true"] { background: #b94a1d; }
.chip .dim { font-weight: 400; opacity: 0.85; }

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
  text-align: center;
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

.note {
  margin: 0;
  font-size: 11px;
  line-height: 16px;
  color: #98a0b5;
}

.note[data-tone="warn"] { color: #ffb08a; }

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
}

.toast[data-tone="error"] { background: #7a2716; color: #ffe8e0; }
`
