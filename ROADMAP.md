# Roadmap

Remaining items from the codebase audit, organized by severity.

## Medium

- [x] HNSW `pruneConnections` mutates Set during iteration
- [x] Version declared in 3 places with different values
- [x] `DistanceMetric` naming collision (type alias vs interface)
- [x] Missing type exports consumers need
- [x] `VectorFrankl.getDefaultNamespace()` TOCTOU race
- [x] Product quantizer `Uint8Array` truncates if centroidsPerSubspace > 256
- [x] `calculateEntropy` NaN for constant vectors
- [x] `Float32Array` returned by reference in `toFloat32Array`
- [x] Dead code: HTTP-oriented errors in `src/errors/custom-errors.ts`
- [x] Quota monitoring listeners not cleaned up
- [x] GPU defaults to `true`

## Low / API Surface

- [x] Seeded RNG uses low-quality LCG
- [x] `VectorStorage.deleteMany` reports success count incorrectly
- [x] `process.env.NODE_ENV` unguarded in `VectorDatabaseError.toJSON()`
- [x] Oversized public API surface (80+ exports, most internal)
- [x] No `sideEffects` field in package.json
- [x] Bundle size (258KB minified, single chunk, not tree-shakeable)
- [x] No CommonJS entrypoint
- [x] `index.test.ts` is a placeholder
- [x] `bunfig.toml` target mismatch with build script
