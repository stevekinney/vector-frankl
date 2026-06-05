type EndToEndVectorMetadata = Record<string, unknown> & {
  category?: unknown;
  description?: unknown;
  type?: unknown;
};

type EndToEndVectorData = {
  id: string;
  vector: Float32Array | number[];
  metadata: EndToEndVectorMetadata;
};

type EndToEndSearchResult = EndToEndVectorData & {
  score: number;
};

type NonEmptyArray<T> = [T, ...T[]];

interface EndToEndVectorDatabase {
  addVector(
    id: string,
    vector: Float32Array | number[],
    metadata?: EndToEndVectorMetadata,
  ): Promise<void>;
  clear(): Promise<void>;
  deleteVector(id: string): Promise<void>;
  getAllVectors(): Promise<EndToEndVectorData[]>;
  getVector(id: string): Promise<EndToEndVectorData>;
  search(
    vector: Float32Array | number[],
    limit: number,
    options?: Record<string, unknown>,
  ): Promise<NonEmptyArray<EndToEndSearchResult>>;
  updateMetadata(id: string, metadata: EndToEndVectorMetadata): Promise<void>;
}

declare global {
  interface Window {
    db: EndToEndVectorDatabase;
    log: (message: string, level?: string) => void;
    addTestResult: (test: string, status: string, details?: string) => void;
  }
}

export {};
