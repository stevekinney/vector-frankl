declare global {
  interface Window {
    db: import('../src/core/database').VectorDatabase;
    log: (message: string) => void;
    addTestResult: (test: string, status: string, details?: string) => void;
  }
}

export {};