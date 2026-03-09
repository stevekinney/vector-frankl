declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any;
    log: (message: string, level?: string) => void;
    addTestResult: (test: string, status: string, details?: string) => void;
  }
}

export {};
