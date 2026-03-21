/**
 * Storage adapters for alternative backends.
 *
 * Deep import: `import { ChromeStorageAdapter } from 'vector-frankl/storage'`
 *
 * Available adapters:
 *   - ChromeStorageAdapter     — Chrome extension storage
 *   - FileSystemStorageAdapter — Bun/Node file system
 *   - LevelStorageAdapter      — LevelDB via `level` package
 *   - LmdbStorageAdapter       — LMDB via `lmdb` package
 *   - OPFSStorageAdapter       — Origin Private File System (browser)
 *   - RedisStorageAdapter      — Redis via Bun built-in client
 *   - S3StorageAdapter         — S3 via Bun built-in S3 client
 *   - SQLiteStorageAdapter     — SQLite via bun:sqlite
 *
 * The MemoryStorageAdapter and IndexedDatabaseStorageAdapter are exported
 * from the main entry point since they have no heavy/optional dependencies.
 */
export { ChromeStorageAdapter } from './storage/adapters/chrome-storage-adapter.js';
export { FileSystemStorageAdapter } from './storage/adapters/file-system-adapter.js';
export { LevelStorageAdapter } from './storage/adapters/level-adapter.js';
export { LmdbStorageAdapter } from './storage/adapters/lmdb-adapter.js';
export { OPFSStorageAdapter } from './storage/adapters/opfs-adapter.js';
export { RedisStorageAdapter } from './storage/adapters/redis-adapter.js';
export { S3StorageAdapter } from './storage/adapters/s3-adapter.js';
export { SQLiteStorageAdapter } from './storage/adapters/sqlite-adapter.js';
