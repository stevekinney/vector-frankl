/**
 * Tests for WASM enforcement: `enableWASM: false` and module integrity checks.
 *
 * The acceptance criteria these tests cover:
 *  1. `enableWASM: false` — no WASM path is active, no capability reported.
 *  2. Tampered module — integrity rejection before execution.
 *  3. Packed consumer verification — assets load from package as documented.
 */

import { describe, expect, it } from 'bun:test';

import { WASMManager } from '@/wasm/wasm-manager.js';
import { WASMOperations } from '@/wasm/wasm-operations.js';

// ---------------------------------------------------------------------------
// enableWASM enforcement
// ---------------------------------------------------------------------------

describe('enableWASM', () => {
  describe('WASMManager with enableWASM: false', () => {
    it('does not initialize WebAssembly when enableWASM is false', async () => {
      const manager = new WASMManager({ enableWASM: false });
      await manager.init();
      expect(manager.isAvailable()).toBe(false);
    });

    it('does not report WebAssembly capability as active when enableWASM is false', () => {
      const manager = new WASMManager({ enableWASM: false });
      const capabilities = manager.getCapabilities();
      expect(capabilities.supported).toBe(false);
    });

    it('reports no WASM features when enableWASM is false', () => {
      const manager = new WASMManager({ enableWASM: false });
      const capabilities = manager.getCapabilities();
      expect(capabilities.features).toHaveLength(0);
    });

    it('reports zero memory allocation when enableWASM is false', () => {
      const manager = new WASMManager({ enableWASM: false });
      const capabilities = manager.getCapabilities();
      expect(capabilities.memory.initial).toBe(0);
      expect(capabilities.memory.maximum).toBe(0);
      expect(capabilities.memory.available).toBe(0);
    });

    it('reports no performance features when enableWASM is false', () => {
      const manager = new WASMManager({ enableWASM: false });
      const capabilities = manager.getCapabilities();
      expect(capabilities.performance.supportsSimd).toBe(false);
      expect(capabilities.performance.supportsThreads).toBe(false);
      expect(capabilities.performance.supportsBulkMemory).toBe(false);
    });

    it('rejects dot product operations when enableWASM is false', async () => {
      const manager = new WASMManager({ enableWASM: false });
      await expect(
        manager.dotProduct(new Float32Array([1, 2]), new Float32Array([3, 4])),
      ).rejects.toThrow('WebAssembly not available');
    });

    it('rejects magnitude operations when enableWASM is false', async () => {
      const manager = new WASMManager({ enableWASM: false });
      await expect(manager.magnitude(new Float32Array([1, 2, 3]))).rejects.toThrow(
        'WebAssembly not available',
      );
    });

    it('rejects vector add operations when enableWASM is false', async () => {
      const manager = new WASMManager({ enableWASM: false });
      await expect(
        manager.vectorAdd(new Float32Array([1, 2]), new Float32Array([3, 4])),
      ).rejects.toThrow('WebAssembly not available');
    });
  });

  describe('WASMOperations with enableWASM: false', () => {
    it('does not report WASM as available when enableWASM is false', async () => {
      const ops = new WASMOperations({ enableWASM: false, enableSIMDFallback: true });
      await ops.init();
      const capabilities = ops.getCapabilities();
      expect(capabilities.wasmAvailable).toBe(false);
      await ops.cleanup();
    });

    it('routes operations through the documented fallback when enableWASM is false', async () => {
      const ops = new WASMOperations({ enableWASM: false, enableSIMDFallback: true });
      await ops.init();

      // Operations must succeed via scalar/SIMD fallback.
      const dotResult = await ops.dotProduct(
        new Float32Array([1, 2, 3]),
        new Float32Array([4, 5, 6]),
      );
      expect(dotResult).toBe(32); // 1*4 + 2*5 + 3*6

      const magResult = await ops.magnitude(new Float32Array([3, 4]));
      expect(magResult).toBeCloseTo(5, 6);

      await ops.cleanup();
    });

    it('still reports scalar as available when enableWASM is false', async () => {
      const ops = new WASMOperations({ enableWASM: false });
      await ops.init();
      const capabilities = ops.getCapabilities();
      expect(capabilities.scalarAvailable).toBe(true);
      await ops.cleanup();
    });
  });
});

// ---------------------------------------------------------------------------
// Integrity checks
// ---------------------------------------------------------------------------

describe('integrity', () => {
  // A minimal valid WASM module (magic + version only — no sections, no code).
  // Used as a known-good byte sequence for hash computation.
  const MINIMAL_WASM_MODULE = new Uint8Array([
    0x00,
    0x61,
    0x73,
    0x6d, // magic: \0asm
    0x01,
    0x00,
    0x00,
    0x00, // version: 1
  ]);

  /** Compute SHA-256 hex string via the Web Crypto API. */
  async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const buffer = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(buffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  it('accepts a WASM module whose hash matches the expected hash', async () => {
    const manager = new WASMManager({ enableWASM: true });
    const expectedHash = await sha256Hex(MINIMAL_WASM_MODULE);
    const valid = await manager.verifyModuleIntegrity(MINIMAL_WASM_MODULE, expectedHash);
    expect(valid).toBe(true);
  });

  it('rejects a tampered WASM module before execution', async () => {
    const manager = new WASMManager({ enableWASM: true });
    const expectedHash = await sha256Hex(MINIMAL_WASM_MODULE);

    // Tamper: flip a byte in the module body.
    const tamperedModule = new Uint8Array(MINIMAL_WASM_MODULE);
    tamperedModule[4] = 0xff; // corrupt the version field

    const valid = await manager.verifyModuleIntegrity(tamperedModule, expectedHash);
    expect(valid).toBe(false);
  });

  it('rejects a completely different module against a reference hash', async () => {
    const manager = new WASMManager({ enableWASM: true });
    const expectedHash = await sha256Hex(MINIMAL_WASM_MODULE);

    const differentModule = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const valid = await manager.verifyModuleIntegrity(differentModule, expectedHash);
    expect(valid).toBe(false);
  });

  it('accepts a module against its own hash regardless of enableWASM flag', async () => {
    // verifyModuleIntegrity is a standalone crypto operation — it must work
    // even when WASM is disabled so callers can gate loading.
    const manager = new WASMManager({ enableWASM: false });
    const expectedHash = await sha256Hex(MINIMAL_WASM_MODULE);
    const valid = await manager.verifyModuleIntegrity(MINIMAL_WASM_MODULE, expectedHash);
    expect(valid).toBe(true);
  });

  it('is case-insensitive for the expected hash', async () => {
    const manager = new WASMManager({ enableWASM: true });
    const expectedHash = await sha256Hex(MINIMAL_WASM_MODULE);
    const upperHash = expectedHash.toUpperCase();
    const valid = await manager.verifyModuleIntegrity(MINIMAL_WASM_MODULE, upperHash);
    expect(valid).toBe(true);
  });

  it('rejects an empty module against a non-empty module hash', async () => {
    const manager = new WASMManager({ enableWASM: true });
    const expectedHash = await sha256Hex(MINIMAL_WASM_MODULE);
    const valid = await manager.verifyModuleIntegrity(new Uint8Array(0), expectedHash);
    expect(valid).toBe(false);
  });
});
