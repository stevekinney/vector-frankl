/**
 * Storage adapters for alternative backends.
 *
 * Deep import: `import { ChromeStorageAdapter } from 'vector-frankl/storage'`
 *
 * Available adapters:
 *   - ChromeStorageAdapter     — Chrome extension storage
 *   - FileSystemStorageAdapter — Bun/Node file system
 *   - OPFSStorageAdapter       — Origin Private File System (browser)
 *   - SQLiteStorageAdapter     — SQLite via sql.js WASM
 *
 * The MemoryStorageAdapter and IndexedDatabaseStorageAdapter are exported
 * from the main entry point since they have no heavy/optional dependencies.
 */
export { ChromeStorageAdapter } from './storage/adapters/chrome-storage-adapter.js';
export { FileSystemStorageAdapter } from './storage/adapters/file-system-adapter.js';
export { OPFSStorageAdapter } from './storage/adapters/opfs-adapter.js';
export { SQLiteStorageAdapter } from './storage/adapters/sqlite-adapter.js';
