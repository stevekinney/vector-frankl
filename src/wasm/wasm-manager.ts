/**
 * WebAssembly manager for optional vector-operation backends.
 */

import { log } from '../utilities/logger.js';

export interface WASMConfig {
  /** Enable WebAssembly optimizations */
  enableWASM?: boolean;
  /** Vector size threshold for WASM operations */
  wasmThreshold?: number;
  /** Enable performance profiling */
  enableProfiling?: boolean;
  /** Maximum memory allocation in bytes */
  maxMemory?: number;
  /** Reserved for a future compiled WASM module path */
  modulePath?: string;
  /**
   * Expected SHA-256 hash (lowercase hex) of the WASM module bytes.
   * When set, `init()` verifies the module against this hash before
   * instantiation and rejects it if tampered.
   */
  expectedHash?: string;
}

export interface WASMCapabilities {
  /** Whether WASM is supported */
  supported: boolean;
  /** Available WASM features */
  features: string[];
  /** Memory allocation details */
  memory: {
    initial: number;
    maximum: number;
    available: number;
  };
  /** Performance characteristics */
  performance: {
    supportsSimd: boolean;
    supportsThreads: boolean;
    supportsBulkMemory: boolean;
  };
}

export interface WASMPerformanceStats {
  /** Processing time in milliseconds */
  processingTime: number;
  /** Number of operations performed */
  operationCount: number;
  /** Operations per second */
  operationsPerSecond: number;
  /** Memory throughput in MB/s */
  memoryThroughput: number;
  /** Memory usage in bytes */
  memoryUsage: number;
}

/**
 * WebAssembly operations manager.
 *
 * The package does not currently bundle a compiled vector-operation module. Keep WASM
 * unavailable unless a real backend is wired in so callers fall back to SIMD/scalar
 * implementations instead of relying on placeholder exports.
 *
 * When `enableWASM: false` is passed, the manager is fully inert: it does not probe
 * WebAssembly runtime support, does not allocate WebAssembly memory, and reports no
 * capabilities as active. All operations route through the documented fallback.
 */
export class WASMManager {
  private config: Required<WASMConfig>;
  private capabilities: WASMCapabilities;
  private wasmInstance: WebAssembly.Instance | null = null;
  private memory: WebAssembly.Memory | null = null;
  private isInitialized = false;

  constructor(config: WASMConfig = {}) {
    this.config = {
      enableWASM: config.enableWASM ?? true,
      wasmThreshold: config.wasmThreshold || 32,
      enableProfiling: config.enableProfiling ?? false,
      maxMemory: config.maxMemory || 64 * 1024 * 1024, // 64MB
      modulePath: config.modulePath || '',
      expectedHash: config.expectedHash || '',
    };

    // When WASM is explicitly disabled, skip capability detection and memory
    // allocation entirely — the manager is fully inert.
    if (!this.config.enableWASM) {
      this.capabilities = this.disabledCapabilities();
      return;
    }

    this.capabilities = this.detectCapabilities();
    // WebAssembly memory pages are 64 KiB each.
    // Ensure maximum is at least 1 page and that initial does not exceed maximum.
    const maximumPages = Math.max(1, Math.floor(this.config.maxMemory / 65536));
    const initialPages = Math.min(256, maximumPages); // 256 pages = 16 MB default initial
    this.memory = new WebAssembly.Memory({
      initial: initialPages,
      maximum: maximumPages,
    });
  }

  /**
   * Return a zeroed-out capabilities object used when WASM is explicitly disabled.
   * Keeps `supported` false so callers see no active WASM capability.
   */
  private disabledCapabilities(): WASMCapabilities {
    return {
      supported: false,
      features: [],
      memory: {
        initial: 0,
        maximum: 0,
        available: 0,
      },
      performance: {
        supportsSimd: false,
        supportsThreads: false,
        supportsBulkMemory: false,
      },
    };
  }

  /**
   * Detect WebAssembly capabilities
   */
  private detectCapabilities(): WASMCapabilities {
    const capabilities: WASMCapabilities = {
      supported: false,
      features: [],
      memory: {
        initial: 16 * 1024 * 1024, // 16MB
        maximum: this.config.maxMemory,
        available: this.config.maxMemory,
      },
      performance: {
        supportsSimd: false,
        supportsThreads: false,
        supportsBulkMemory: false,
      },
    };

    try {
      // Check basic WebAssembly support
      if (typeof WebAssembly !== 'undefined' && WebAssembly.validate) {
        capabilities.supported = true;
        capabilities.features.push('basic');

        // Test SIMD support
        try {
          const simdTest = new Uint8Array([
            0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60, 0x00,
            0x01, 0x7b, 0x03, 0x02, 0x01, 0x00, 0x0a, 0x07, 0x01, 0x05, 0x00, 0xfd, 0x0f,
            0x0b,
          ]);

          if (WebAssembly.validate(simdTest)) {
            capabilities.performance.supportsSimd = true;
            capabilities.features.push('simd');
          }
        } catch {
          // SIMD not supported
        }

        // Test bulk memory operations
        try {
          const bulkTest = new Uint8Array([
            0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x04, 0x01, 0x60, 0x00,
            0x00, 0x03, 0x02, 0x01, 0x00, 0x05, 0x03, 0x01, 0x00, 0x00, 0x0a, 0x09, 0x01,
            0x07, 0x00, 0x41, 0x00, 0x41, 0x00, 0x41, 0x00, 0xfc, 0x08, 0x0b,
          ]);

          if (WebAssembly.validate(bulkTest)) {
            capabilities.performance.supportsBulkMemory = true;
            capabilities.features.push('bulk-memory');
          }
        } catch {
          // Bulk memory not supported
        }

        // Test thread support (SharedArrayBuffer required)
        if (typeof SharedArrayBuffer !== 'undefined') {
          capabilities.performance.supportsThreads = true;
          capabilities.features.push('threads');
        }
      }
    } catch {
      capabilities.supported = false;
    }

    return capabilities;
  }

  /**
   * Initialize WebAssembly module with security validation.
   *
   * When `enableWASM: false` is configured the method is a no-op — it never
   * touches the WebAssembly API.  When a `modulePath` is configured AND an
   * `expectedHash` is provided, the module bytes are verified before
   * instantiation; a hash mismatch throws immediately so a tampered module is
   * never executed.
   */
  async init(): Promise<void> {
    if (this.isInitialized || !this.config.enableWASM || !this.capabilities.supported) {
      return;
    }

    try {
      if (!this.config.modulePath) {
        log.debug('No WebAssembly module configured; using SIMD/scalar fallbacks');
        return;
      }

      // Load module bytes for integrity verification before instantiation.
      const response = await fetch(this.config.modulePath);
      if (!response.ok) {
        throw new Error(`Failed to fetch WASM module: HTTP ${response.status}`);
      }

      const moduleBytes = new Uint8Array(await response.arrayBuffer());

      // If an expected hash is configured, verify before executing the module.
      if (this.config.expectedHash) {
        const valid = await this.verifyModuleIntegrity(
          moduleBytes,
          this.config.expectedHash,
        );
        if (!valid) {
          throw new Error(
            'WebAssembly module integrity check failed: hash mismatch. ' +
              'The module may have been tampered with.',
          );
        }
      }

      log.warn('External WebAssembly modules are not enabled in this build');
    } catch (error) {
      log.warn('Failed to initialize WebAssembly', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.capabilities.supported = false;
      throw error;
    }
  }

  /**
   * Check if WebAssembly is available and initialized
   */
  isAvailable(): boolean {
    return this.capabilities.supported && this.isInitialized;
  }

  /**
   * Get WebAssembly capabilities
   */
  getCapabilities(): WASMCapabilities {
    return { ...this.capabilities };
  }

  /**
   * Verify the integrity of a WebAssembly module before execution.
   *
   * Computes the SHA-256 hash of `moduleBytes` and compares it against
   * `expectedHash` (a lowercase hex string). Returns `true` when the hashes
   * match, `false` otherwise. Callers MUST reject the module when this returns
   * `false` — executing an unverified module is a security violation.
   *
   * This method works regardless of whether `enableWASM` is set, so callers
   * can use it as a standalone integrity gate before deciding whether to load.
   */
  async verifyModuleIntegrity(
    moduleBytes: Uint8Array,
    expectedHash: string,
  ): Promise<boolean> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', moduleBytes);
    const hashArray = new Uint8Array(hashBuffer);
    const actualHash = Array.from(hashArray)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return actualHash === expectedHash.toLowerCase();
  }

  /**
   * Allocate memory for vector data
   */
  allocateVector(length: number): { ptr: number; byteLength: number } {
    if (!this.memory) {
      throw new Error('WebAssembly memory not available');
    }

    const byteLength = length * 4; // Float32 = 4 bytes

    // Reject before attempting memory growth to prevent exhaustion attacks.
    // WebAssembly memory pages are 64 KiB each; the configured maxMemory caps growth.
    if (byteLength > this.config.maxMemory) {
      throw new Error(
        `WASM allocation of ${byteLength} bytes exceeds the maximum allowed memory of ${this.config.maxMemory} bytes`,
      );
    }

    const currentPages = this.memory.buffer.byteLength / 65536;
    const requiredPages = Math.ceil(byteLength / 65536);

    if (currentPages < requiredPages) {
      try {
        this.memory.grow(requiredPages - currentPages);
      } catch (error) {
        throw new Error(`Failed to allocate WASM memory: ${error}`, { cause: error });
      }
    }

    // Allocate at the top of the current memory buffer.
    // This is a bump-pointer strategy: safe for single-use scratch allocations.
    const ptr = this.memory.buffer.byteLength - byteLength;
    return { ptr, byteLength };
  }

  /**
   * Copy JavaScript Float32Array to WASM memory
   */
  copyToWASM(vector: Float32Array, ptr: number): void {
    if (!this.memory) {
      throw new Error('WebAssembly memory not available');
    }

    const wasmMemory = new Float32Array(this.memory.buffer, ptr, vector.length);
    wasmMemory.set(vector);
  }

  /**
   * Copy data from WASM memory to JavaScript Float32Array
   */
  copyFromWASM(ptr: number, length: number): Float32Array {
    if (!this.memory) {
      throw new Error('WebAssembly memory not available');
    }

    const wasmMemory = new Float32Array(this.memory.buffer, ptr, length);
    return new Float32Array(wasmMemory);
  }

  /**
   * Compute dot product using WebAssembly
   */
  async dotProduct(vectorA: Float32Array, vectorB: Float32Array): Promise<number> {
    if (vectorA.length !== vectorB.length) {
      throw new Error('Vector dimensions must match');
    }

    if (!this.isAvailable() || !this.wasmInstance) {
      throw new Error('WebAssembly not available');
    }

    const startTime = this.config.enableProfiling ? performance.now() : 0;

    try {
      const exports = this.wasmInstance.exports as {
        dotProduct: (aPtr: number, bPtr: number, length: number) => number;
      };

      const aAlloc = this.allocateVector(vectorA.length);
      const bAlloc = this.allocateVector(vectorB.length);
      this.copyToWASM(vectorA, aAlloc.ptr);
      this.copyToWASM(vectorB, bAlloc.ptr);

      const result = exports.dotProduct(aAlloc.ptr, bAlloc.ptr, vectorA.length);

      if (this.config.enableProfiling) {
        const endTime = performance.now();
        log.debug('WASM dot product completed', {
          durationMilliseconds: endTime - startTime,
          elementCount: vectorA.length,
        });
      }

      return result;
    } catch (error) {
      throw new Error(`WASM dot product failed: ${error}`, { cause: error });
    }
  }

  /**
   * Compute vector magnitude using WebAssembly
   */
  async magnitude(vector: Float32Array): Promise<number> {
    if (!this.isAvailable() || !this.wasmInstance) {
      throw new Error('WebAssembly not available');
    }

    const startTime = this.config.enableProfiling ? performance.now() : 0;

    try {
      const exports = this.wasmInstance.exports as {
        magnitude: (ptr: number, length: number) => number;
      };

      const alloc = this.allocateVector(vector.length);
      this.copyToWASM(vector, alloc.ptr);

      const result = exports.magnitude(alloc.ptr, vector.length);

      if (this.config.enableProfiling) {
        const endTime = performance.now();
        log.debug('WASM magnitude completed', {
          durationMilliseconds: endTime - startTime,
          elementCount: vector.length,
        });
      }

      return result;
    } catch (error) {
      throw new Error(`WASM magnitude failed: ${error}`, { cause: error });
    }
  }

  /**
   * Vector addition using WebAssembly
   */
  async vectorAdd(vectorA: Float32Array, vectorB: Float32Array): Promise<Float32Array> {
    if (vectorA.length !== vectorB.length) {
      throw new Error('Vector dimensions must match');
    }

    if (!this.isAvailable() || !this.wasmInstance) {
      throw new Error('WebAssembly not available');
    }

    const startTime = this.config.enableProfiling ? performance.now() : 0;

    try {
      const exports = this.wasmInstance.exports as {
        vectorAdd: (aPtr: number, bPtr: number, outPtr: number, length: number) => void;
      };

      const aAlloc = this.allocateVector(vectorA.length);
      const bAlloc = this.allocateVector(vectorB.length);
      const outAlloc = this.allocateVector(vectorA.length);
      this.copyToWASM(vectorA, aAlloc.ptr);
      this.copyToWASM(vectorB, bAlloc.ptr);

      exports.vectorAdd(aAlloc.ptr, bAlloc.ptr, outAlloc.ptr, vectorA.length);

      const result = this.copyFromWASM(outAlloc.ptr, vectorA.length);

      if (this.config.enableProfiling) {
        const endTime = performance.now();
        log.debug('WASM vector add completed', {
          durationMilliseconds: endTime - startTime,
          elementCount: vectorA.length,
        });
      }

      return result;
    } catch (error) {
      throw new Error(`WASM vector add failed: ${error}`, { cause: error });
    }
  }

  /**
   * Benchmark WASM vs JavaScript performance
   */
  async benchmark(
    vectorLength: number = 1000,
    iterations: number = 100,
  ): Promise<{
    wasm: WASMPerformanceStats;
    javascript: WASMPerformanceStats;
    speedup: number;
  }> {
    if (!this.isAvailable()) {
      throw new Error('WebAssembly not available for benchmarking');
    }

    const vectorA = new Float32Array(
      Array.from({ length: vectorLength }, () => Math.random()),
    );
    const vectorB = new Float32Array(
      Array.from({ length: vectorLength }, () => Math.random()),
    );

    // Benchmark WASM
    const wasmStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      await this.dotProduct(vectorA, vectorB);
    }
    const wasmEnd = performance.now();
    const wasmTime = wasmEnd - wasmStart;

    // Benchmark JavaScript
    const jsStart = performance.now();
    let javascriptChecksum = 0;
    for (let i = 0; i < iterations; i++) {
      let sum = 0;
      for (let j = 0; j < vectorA.length; j++) {
        sum += (vectorA[j] ?? 0) * (vectorB[j] ?? 0);
      }
      javascriptChecksum += sum;
    }
    const jsEnd = performance.now();
    const jsTime = jsEnd - jsStart;

    if (!Number.isFinite(javascriptChecksum)) {
      throw new Error('JavaScript benchmark produced a non-finite checksum');
    }

    const dataSize = vectorLength * 4 * 2; // 2 vectors * 4 bytes per float
    const totalData = (dataSize * iterations) / (1024 * 1024); // MB

    return {
      wasm: {
        processingTime: wasmTime,
        operationCount: iterations,
        operationsPerSecond: iterations / (wasmTime / 1000),
        memoryThroughput: totalData / (wasmTime / 1000),
        memoryUsage: this.memory?.buffer.byteLength || 0,
      },
      javascript: {
        processingTime: jsTime,
        operationCount: iterations,
        operationsPerSecond: iterations / (jsTime / 1000),
        memoryThroughput: totalData / (jsTime / 1000),
        memoryUsage: vectorLength * 8, // Approximate JS memory usage
      },
      speedup: jsTime / wasmTime,
    };
  }

  /**
   * Cleanup WebAssembly resources
   */
  async cleanup(): Promise<void> {
    this.wasmInstance = null;
    this.memory = null;
    this.isInitialized = false;
  }
}

/**
 * Singleton instance for global WASM operations
 */
export const wasmManager = new WASMManager();
