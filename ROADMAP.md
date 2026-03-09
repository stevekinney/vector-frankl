# Roadmap

Remaining items from the codebase audit, organized by severity.

## Medium

- [ ] HNSW `pruneConnections` mutates Set during iteration
- [ ] Version declared in 3 places with different values
- [ ] `DistanceMetric` naming collision (type alias vs interface)
- [ ] Missing type exports consumers need
- [ ] `VectorFrankl.getDefaultNamespace()` TOCTOU race
- [ ] Product quantizer `Uint8Array` truncates if centroidsPerSubspace > 256
- [ ] `calculateEntropy` NaN for constant vectors
- [ ] `Float32Array` returned by reference in `toFloat32Array`
- [ ] Dead code: HTTP-oriented errors in `src/errors/custom-errors.ts`
- [ ] Quota monitoring listeners not cleaned up
- [ ] GPU defaults to `true`

## Low / API Surface

- [ ] Seeded RNG uses low-quality LCG
- [ ] `VectorStorage.deleteMany` reports success count incorrectly
- [ ] `process.env.NODE_ENV` unguarded in `VectorDatabaseError.toJSON()`
- [ ] Oversized public API surface (80+ exports, most internal)
- [ ] No `sideEffects` field in package.json
- [ ] Bundle size (258KB minified, single chunk, not tree-shakeable)
- [ ] No CommonJS entrypoint
- [ ] `index.test.ts` is a placeholder
- [ ] `bunfig.toml` target mismatch with build script
