/**
 * Engine identity stamped into every generated tokens document.
 *
 * Bumping the version changes the bytes of every example, so bump it only when
 * the distillation result itself changes and regenerate `examples/` in the same
 * commit (`pnpm skeleton`).
 */
export const ENGINE_NAME = 'ingot-engine'
export const ENGINE_VERSION = '0.3.0'
