# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0-beta.1] - 2024-01-07

### Added

- Initial beta release of Vector Frankl
- Core vector database functionality with IndexedDB storage
- Multiple namespace support for isolated vector collections
- Support for multiple vector formats (Float32Array, Float64Array, Int8Array, Uint8Array, arrays)
- Multiple distance metrics (Cosine, Euclidean, Manhattan, Hamming, Jaccard)
- HNSW (Hierarchical Navigable Small World) indexing for fast similarity search
- Vector compression strategies (Scalar quantization, Product quantization, Binary)
- Storage quota management with eviction policies (LRU, LFU, TTL, Score-based)
- Web Worker pool for parallel processing
- SIMD acceleration for vector operations
- WebGPU support for GPU-accelerated search
- WebAssembly modules for high-performance operations
- Comprehensive input validation and security features
- ReDoS (Regular Expression Denial of Service) protection
- Memory safety with configurable limits
- Debug and profiling tools
- Comprehensive benchmarking suite
- Full TypeScript support with strict mode compliance
- Detailed API documentation
- Security best practices guide

### Security

- Input validation for all user inputs
- ReDoS protection with timeout and pattern validation
- Memory limits to prevent exhaustion attacks
- WASM module integrity verification
- Sanitized error messages to prevent information leakage

### Performance

- Synchronous vector operations for 30-50% performance improvement
- Automatic batch size optimization
- Adaptive index strategy selection
- Zero-copy operations with SharedArrayBuffer support
- Efficient storage with compression options

### Known Issues

- SharedArrayBuffer support limited in some browser contexts
- WebGPU requires compatible hardware and browser
- Some advanced features may not work in all environments

[1.0.0-beta.1]: https://github.com/stevekinney/vector-frankl/releases/tag/v1.0.0-beta.1
