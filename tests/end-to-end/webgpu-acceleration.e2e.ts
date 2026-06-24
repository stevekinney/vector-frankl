/**
 * WebGPU acceleration end-to-end tests.
 *
 * These tests verify WebGPU browser-API semantics in a real browser context.
 * They exercise the native browser WebGPU API (adapter negotiation, device
 * creation, shader compilation, buffer operations, compute dispatch) to
 * confirm the exact behaviors that `WebGPUManager` relies on at runtime.
 *
 * Tests that require a real GPU adapter are gated on actual WebGPU
 * availability and explicitly skip (via `test.skip()`) when the capability is
 * absent — the explicit skip IS the unsupported classification required by the
 * production-readiness acceptance criteria. A capability-only mock is never
 * used here.
 *
 * Unit tests that exercise WebGPU code paths through mocks live in
 * tests/gpu/ and are intentionally kept separate; they do NOT constitute
 * production-readiness evidence for real-browser WebGPU semantics.
 */

import { expect, test } from '@playwright/test';

// ── Helpers ────────────────────────────────────────────────────────────────

/** WGSL compute shader that writes 1.0 to each element of a storage buffer. */
const FILL_SHADER = /* wgsl */ `
  @group(0) @binding(0) var<storage, read_write> output: array<f32>;

  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x < arrayLength(&output)) {
      output[id.x] = 1.0;
    }
  }
`;

// ── Capability detection (always runs) ────────────────────────────────────

test.describe('WebGPU Capability Detection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('reports WebGPU availability for this browser/environment', async ({ page }) => {
    const gpuInfo = await page.evaluate(async () => {
      const available = typeof navigator !== 'undefined' && 'gpu' in navigator;
      let adapterOk = false;
      let reason = 'navigator.gpu not present';

      if (available) {
        try {
          const adapter = await navigator.gpu!.requestAdapter();
          adapterOk = adapter !== null;
          reason = adapterOk ? 'adapter obtained' : 'requestAdapter returned null';
        } catch (err) {
          reason = `requestAdapter threw: ${(err as Error).message}`;
        }
      }

      return { available, adapterOk, reason };
    });

    // Annotate the test result for CI diagnostics. Playwright stores this in
    // the HTML report and JSON output without polluting stdout.
    test.info().annotations.push({
      type: 'webgpu-capability',
      description: `available=${gpuInfo.available}, adapter=${gpuInfo.adapterOk}, reason=${gpuInfo.reason}`,
    });

    // The test passes regardless of capability — the annotation is the record.
    expect(typeof gpuInfo.available).toBe('boolean');
  });
});

// ── Real-browser WebGPU tests (skip when unsupported) ─────────────────────

test.describe('WebGPU Real-Browser Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Gate every test in this suite on real WebGPU availability.
    // Using test.skip() is the explicit unsupported classification required
    // by the production-readiness acceptance criteria: these tests either
    // run against real WebGPU or are classified as unsupported — never mocked.
    const hasWebGPU = await page.evaluate(async () => {
      if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
        return false;
      }
      try {
        const adapter = await navigator.gpu!.requestAdapter();
        return adapter !== null;
      } catch {
        return false;
      }
    });

    if (!hasWebGPU) {
      test.skip();
    }
  });

  test('requestAdapter returns a non-null GPUAdapter', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const adapter = await navigator.gpu!.requestAdapter();
        if (!adapter) return { ok: false, error: 'requestAdapter returned null' };

        const info = await (
          adapter as unknown as { requestAdapterInfo?: () => Promise<unknown> }
        ).requestAdapterInfo?.();
        return {
          ok: true,
          hasLimits: typeof (adapter as any).limits === 'object',
          hasFeatures: typeof (adapter as any).features === 'object',
          vendorDefined: typeof (info as { vendor?: unknown })?.vendor === 'string',
        };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    });

    expect(result.ok, result.ok ? '' : String((result as any).error)).toBe(true);
    expect((result as any).hasLimits).toBe(true);
    expect((result as any).hasFeatures).toBe(true);
  });

  test('requestDevice returns a functional GPUDevice', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const adapter = await navigator.gpu!.requestAdapter();
        if (!adapter) return { ok: false, error: 'No adapter' };

        const device = await adapter.requestDevice();
        const hasQueue = device.queue !== undefined;
        const hasCreateBuffer = typeof device.createBuffer === 'function';
        const hasCreateShaderModule = typeof device.createShaderModule === 'function';
        const hasCreateCommandEncoder = typeof device.createCommandEncoder === 'function';

        device.destroy();
        return {
          ok: true,
          hasQueue,
          hasCreateBuffer,
          hasCreateShaderModule,
          hasCreateCommandEncoder,
        };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    });

    expect(result.ok, result.ok ? '' : String((result as any).error)).toBe(true);
    expect((result as any).hasQueue).toBe(true);
    expect((result as any).hasCreateBuffer).toBe(true);
    expect((result as any).hasCreateShaderModule).toBe(true);
    expect((result as any).hasCreateCommandEncoder).toBe(true);
  });

  test('GPUBuffer allocation and read-back round-trip', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const adapter = await navigator.gpu!.requestAdapter();
        if (!adapter) return { ok: false, error: 'No adapter' };
        const device = await adapter.requestDevice();

        const floatCount = 16;
        const byteSize = floatCount * Float32Array.BYTES_PER_ELEMENT;

        // Write buffer
        const writeBuffer = device.createBuffer({
          size: byteSize,
          usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.MAP_WRITE,
          mappedAtCreation: true,
        });
        const writeView = new Float32Array(writeBuffer.getMappedRange());
        for (let i = 0; i < floatCount; i++) writeView[i] = i * 0.5;
        writeBuffer.unmap();

        // Read-back buffer
        const readBuffer = device.createBuffer({
          size: byteSize,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });

        const encoder = device.createCommandEncoder();
        encoder.copyBufferToBuffer(writeBuffer, 0, readBuffer, 0, byteSize);
        device.queue.submit([encoder.finish()]);

        await readBuffer.mapAsync(GPUMapMode.READ);
        const readView = new Float32Array(readBuffer.getMappedRange());
        const values = Array.from(readView);
        readBuffer.unmap();

        writeBuffer.destroy();
        readBuffer.destroy();
        device.destroy();

        // Verify round-trip: every value should equal index * 0.5
        const allMatch = values.every((v, i) => Math.abs(v - i * 0.5) < 0.0001);
        return { ok: true, allMatch, count: values.length };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    });

    expect(result.ok, result.ok ? '' : String((result as any).error)).toBe(true);
    expect((result as any).allMatch).toBe(true);
    expect((result as any).count).toBe(16);
  });

  test('compute shader dispatches and writes output', async ({ page }) => {
    const shader = FILL_SHADER;

    const result = await page.evaluate(async (wgsl) => {
      try {
        const adapter = await navigator.gpu!.requestAdapter();
        if (!adapter) return { ok: false, error: 'No adapter' };
        const device = await adapter.requestDevice();

        const elementCount = 64;
        const byteSize = elementCount * Float32Array.BYTES_PER_ELEMENT;

        // Storage buffer for compute output
        const storageBuffer = device.createBuffer({
          size: byteSize,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });

        // Read-back buffer
        const readBuffer = device.createBuffer({
          size: byteSize,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });

        const shaderModule = device.createShaderModule({ code: wgsl });
        const pipeline = await (device as any).createComputePipelineAsync({
          layout: 'auto',
          compute: { module: shaderModule, entryPoint: 'main' },
        });

        const bindGroup = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: storageBuffer } }],
        });

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(1);
        pass.end();
        encoder.copyBufferToBuffer(storageBuffer, 0, readBuffer, 0, byteSize);
        device.queue.submit([encoder.finish()]);

        await readBuffer.mapAsync(GPUMapMode.READ);
        const output = new Float32Array(readBuffer.getMappedRange());
        const values = Array.from(output);
        readBuffer.unmap();

        storageBuffer.destroy();
        readBuffer.destroy();
        device.destroy();

        const allOnes = values.every((v) => Math.abs(v - 1.0) < 0.0001);
        return { ok: true, allOnes, count: values.length };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    }, shader);

    expect(result.ok, result.ok ? '' : String((result as any).error)).toBe(true);
    expect((result as any).allOnes).toBe(true);
    expect((result as any).count).toBe(64);
  });

  test('GPUDevice limits expose maxStorageBufferBindingSize', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const adapter = await navigator.gpu!.requestAdapter();
        if (!adapter) return { ok: false, error: 'No adapter' };
        const device = await adapter.requestDevice();

        const maxSize = (
          device as unknown as { limits: { maxStorageBufferBindingSize: number } }
        ).limits.maxStorageBufferBindingSize;
        device.destroy();

        return { ok: true, maxSize };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    });

    expect(result.ok, result.ok ? '' : String((result as any).error)).toBe(true);
    // The spec minimum is 128MB; real devices and SwiftShader both report at least this.
    expect((result as any).maxSize).toBeGreaterThanOrEqual(128 * 1024 * 1024);
  });

  test('unsupported preferred device feature is gracefully absent', async ({ page }) => {
    // This verifies the feature-query path that WebGPUManager uses to
    // detect capabilities before configuring shader dispatch sizes.
    const result = await page.evaluate(async () => {
      try {
        const adapter = await navigator.gpu!.requestAdapter();
        if (!adapter) return { ok: false, error: 'No adapter' };

        // 'timestamp-query' is optional; ask for it and confirm device still initializes.
        const hasTimestampQuery =
          (adapter as any).features?.has('timestamp-query') ?? false;

        const device = await adapter.requestDevice(
          hasTimestampQuery ? { requiredFeatures: ['timestamp-query'] } : {},
        );

        const deviceHasFeature = hasTimestampQuery
          ? ((
              device as unknown as { features?: { has(n: string): boolean } }
            ).features?.has('timestamp-query') ?? false)
          : true; // If we didn't ask for it, the device is still valid.

        device.destroy();
        return { ok: true, hasTimestampQuery, deviceHasFeature };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    });

    expect(result.ok, result.ok ? '' : String((result as any).error)).toBe(true);
    expect((result as any).deviceHasFeature).toBe(true);
  });
});
