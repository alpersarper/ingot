import { defineConfig } from 'vitest/config'

/**
 * One `pnpm test` across the workspace, split by what each part needs.
 *
 * The engine and the server are Node; the panel is a browser app and needs
 * jsdom plus its own Vite config for the React plugin. Keeping them as separate
 * projects is what lets the engine suite stay exactly as pure as it was.
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
          name: 'server',
          include: ['apps/server/test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: './apps/panel/vite.config.ts',
        test: {
          name: 'panel',
          include: ['apps/panel/test/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['./apps/panel/test/setup.ts'],
        },
      },
    ],
  },
})
