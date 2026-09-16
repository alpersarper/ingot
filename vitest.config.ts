import { defineConfig } from 'vitest/config'

/**
 * One `pnpm test` across the workspace, split by what each part needs.
 *
 * The engine, the server and the extension are Node; the panel is a browser
 * app and needs jsdom plus its own Vite config for the React plugin. Keeping
 * them as separate projects is what lets the engine suite stay exactly as pure
 * as it was.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'engine',
          include: ['packages/*/test/**/*.test.ts', 'test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          // The extension is a browser app, but everything worth testing in it
          // is deliberately pure: extraction takes a property reader rather
          // than an element, and the buffer takes a store rather than
          // `chrome.storage`. So it runs in Node, and the parts that genuinely
          // need Chrome are the parts a test could only fake.
          name: 'extension',
          include: ['apps/extension/test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'server',
          include: ['apps/server/test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: './apps/panel/vite.config.ts',
        test: {
          name: 'panel',
          include: ['apps/panel/test/**/*.test.ts', 'apps/panel/test/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['./apps/panel/test/setup.ts'],
          // The static docs export inlines `canonical.css` and `docs.css` with
          // `?raw`. Vitest stubs CSS imports to an empty string by default, so
          // without this the export test would pass against a page that has no
          // stylesheet in it at all.
          css: true,
        },
      },
    ],
  },
})
