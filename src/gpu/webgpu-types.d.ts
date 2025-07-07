/**
 * WebGPU type definitions for environments that don't have them globally available
 */

declare global {
  interface Navigator {
    gpu?: GPU;
  }

  interface GPU {
    requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>;
    getPreferredCanvasFormat(): GPUTextureFormat;
  }

  interface GPURequestAdapterOptions {
    powerPreference?: 'low-power' | 'high-performance';
    forceFallbackAdapter?: boolean;
  }

  interface GPUAdapter {
    features: GPUFeatureNameSet;
    limits: GPUSupportedLimits;
    requestDevice(descriptor?: GPUDeviceDescriptor): Promise<GPUDevice>;
  }

  type GPUFeatureNameSet = Set<string>;

  interface GPUSupportedLimits {
    maxStorageBufferBindingSize: number;
    maxComputeWorkgroupSizeX: number;
    maxComputeWorkgroupSizeY: number;
    maxComputeInvocationsPerWorkgroup: number;
  }

  interface GPUDeviceDescriptor {
    requiredFeatures?: string[];
    requiredLimits?: {
      maxStorageBufferBindingSize?: number;
    };
  }

  interface GPUDevice extends EventTarget {
    queue: GPUQueue;
    createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer;
    createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule;
    createComputePipeline(descriptor: GPUComputePipelineDescriptor): GPUComputePipeline;
    createBindGroup(descriptor: GPUBindGroupDescriptor): GPUBindGroup;
    createCommandEncoder(descriptor?: GPUCommandEncoderDescriptor): GPUCommandEncoder;
    destroy(): void;
    pushErrorScope(filter: GPUErrorFilter): void;
    popErrorScope(): Promise<GPUError | null>;
  }

  interface GPUQueue {
    submit(commandBuffers: GPUCommandBuffer[]): void;
    writeBuffer(
      buffer: GPUBuffer,
      bufferOffset: number,
      data: ArrayBufferView | ArrayBuffer,
      dataOffset?: number,
      size?: number
    ): void;
  }

  interface GPUBuffer {
    size: number;
    usage: number;
    mapAsync(mode: number, offset?: number, size?: number): Promise<void>;
    getMappedRange(offset?: number, size?: number): ArrayBuffer;
    unmap(): void;
    destroy(): void;
  }

  interface GPUBufferDescriptor {
    size: number;
    usage: number;
    mappedAtCreation?: boolean;
  }

  var GPUBufferUsage: {
    MAP_READ: number;
    MAP_WRITE: number;
    COPY_SRC: number;
    COPY_DST: number;
    INDEX: number;
    VERTEX: number;
    UNIFORM: number;
    STORAGE: number;
    INDIRECT: number;
    QUERY_RESOLVE: number;
  };

  var GPUMapMode: {
    READ: number;
    WRITE: number;
  };

  interface GPUShaderModule {
    label?: string;
  }

  interface GPUShaderModuleDescriptor {
    label?: string;
    code: string;
  }

  interface GPUComputePipeline {
    getBindGroupLayout(index: number): GPUBindGroupLayout;
  }

  interface GPUComputePipelineDescriptor {
    label?: string;
    layout?: 'auto' | GPUPipelineLayout;
    compute: {
      module: GPUShaderModule;
      entryPoint?: string;
    };
  }

  interface GPUBindGroup {
    label?: string;
  }

  interface GPUBindGroupDescriptor {
    layout: GPUBindGroupLayout;
    entries: GPUBindGroupEntry[];
  }

  interface GPUBindGroupEntry {
    binding: number;
    resource: GPUBindingResource;
  }

  interface GPUBindingResource {
    buffer?: GPUBuffer;
    offset?: number;
    size?: number;
  }

  interface GPUBindGroupLayout {
    label?: string;
  }
  interface GPUPipelineLayout {
    label?: string;
  }

  interface GPUCommandEncoder {
    beginComputePass(descriptor?: GPUComputePassDescriptor): GPUComputePassEncoder;
    copyBufferToBuffer(
      source: GPUBuffer,
      sourceOffset: number,
      destination: GPUBuffer,
      destinationOffset: number,
      size: number
    ): void;
    finish(descriptor?: GPUCommandBufferDescriptor): GPUCommandBuffer;
  }

  interface GPUCommandEncoderDescriptor {
    label?: string;
  }

  interface GPUComputePassDescriptor {
    label?: string;
  }

  interface GPUComputePassEncoder {
    setPipeline(pipeline: GPUComputePipeline): void;
    setBindGroup(index: number, bindGroup: GPUBindGroup): void;
    dispatchWorkgroups(x: number, y?: number, z?: number): void;
    end(): void;
  }

  interface GPUCommandBuffer {
    label?: string;
  }

  interface GPUCommandBufferDescriptor {
    label?: string;
  }

  type GPUTextureFormat = string;

  interface GPUError {
    message: string;
  }

  type GPUErrorFilter = 'validation' | 'out-of-memory' | 'internal';

  interface GPUUncapturedErrorEvent extends Event {
    error: GPUError;
  }
}

export {};