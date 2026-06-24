/**
 * Debug, profiling, and diagnostics tools.
 * Import via: vector-frankl/debug
 *
 * Re-exports the full debug barrel so the public `vector-frankl/debug`
 * entrypoint exposes everything the internal module does — including the
 * diagnostics surface (HealthMonitor, ObservabilityManager) documented for
 * consumers. Keeping this as a star re-export prevents the entrypoint from
 * drifting behind `src/debug/index.ts` as new diagnostics are added.
 */
export * from './debug/index.js';
export { default } from './debug/index.js';
