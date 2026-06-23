/**
 * Verify README documentation claims match verified behavior.
 *
 * Checks:
 * 1. Production-readiness section is present with required labels.
 * 2. Deep import paths in README code examples are registered in package.json exports.
 * 3. Core API class names claimed in README are exported from their source modules.
 * 4. WASM claims are correctly qualified (experimental, not described as stable acceleration).
 */

type PackageJson = {
  exports?: Record<string, unknown>;
};

const readmeText = await Bun.file('README.md').text();
const packageJson = (await Bun.file('package.json').json()) as PackageJson;

let failures = 0;

function fail(message: string): void {
  console.error(`  FAIL  ${message}`);
  failures++;
}

function pass(message: string): void {
  console.log(`  PASS  ${message}`);
}

// ---------------------------------------------------------------------------
// 1. Production-readiness section and required labels
// ---------------------------------------------------------------------------

console.log('\nChecking production-readiness section and labels...');

const requiredLabels: string[] = [
  'Production Readiness',
  'Stable',
  'Beta',
  'Experimental',
  'Unsupported',
];

for (const label of requiredLabels) {
  if (readmeText.includes(label)) {
    pass(`Label "${label}" found`);
  } else {
    fail(`Label "${label}" missing from README`);
  }
}

// ---------------------------------------------------------------------------
// 2. Deep import paths referenced in README exist in package.json exports
// ---------------------------------------------------------------------------

console.log('\nChecking package export paths referenced in README code examples...');

const deepImportPattern = /from 'vector-frankl\/((?!adapters)[^']+)'/g;
const adapterImportPattern = /from 'vector-frankl\/(adapters\/[^']+)'/g;

const claimedPaths = new Set<string>();
let m: RegExpExecArray | null;

while ((m = deepImportPattern.exec(readmeText)) !== null) {
  if (m[1]) claimedPaths.add(m[1]);
}
while ((m = adapterImportPattern.exec(readmeText)) !== null) {
  if (m[1]) claimedPaths.add(m[1]);
}

const pkgExports = packageJson.exports ?? {};

for (const exportName of claimedPaths) {
  const key = `./${exportName}`;
  if (key in pkgExports) {
    pass(`package.json exports "${key}"`);
  } else {
    fail(
      `README references "vector-frankl/${exportName}" but it is absent from package.json exports`,
    );
  }
}

if (claimedPaths.size === 0) {
  pass('No deep import paths found (nothing to check)');
}

// ---------------------------------------------------------------------------
// 3. Core API class names are exported from their source modules
// ---------------------------------------------------------------------------

console.log('\nChecking core API exports exist in source modules...');

const coreSrc = await Bun.file('src/index.ts').text();

const requiredCoreExports: string[] = [
  'VectorDB',
  'VectorFrankl',
  'MemoryStorageAdapter',
  'IndexedDatabaseStorageAdapter',
  'OPFSStorageAdapter',
  'HNSWIndex',
  'EvictionManager',
  'StorageQuotaMonitor',
];

for (const name of requiredCoreExports) {
  if (coreSrc.includes(name)) {
    pass(`"${name}" is exported from src/index.ts`);
  } else {
    fail(`"${name}" claimed in README but not found in src/index.ts`);
  }
}

const gpuSrc = await Bun.file('src/gpu.ts').text();
if (gpuSrc.includes('GPUSearchEngine')) {
  pass('"GPUSearchEngine" exported from src/gpu.ts');
} else {
  fail('"GPUSearchEngine" claimed in README but not found in src/gpu.ts');
}

const workersSrc = await Bun.file('src/workers.ts').text();
if (workersSrc.includes('WorkerPool')) {
  pass('"WorkerPool" exported from src/workers.ts');
} else {
  fail('"WorkerPool" claimed in README but not found in src/workers.ts');
}

const compressionSrc = await Bun.file('src/compression.ts').text();
if (compressionSrc.includes('CompressionManager')) {
  pass('"CompressionManager" exported from src/compression.ts');
} else {
  fail('"CompressionManager" claimed in README but not found in src/compression.ts');
}

// ---------------------------------------------------------------------------
// 4. WASM claims are correctly qualified
//    The package ships no compiled WASM module; any WASM mention that claims
//    production-grade acceleration without an experimental qualifier is a false claim.
// ---------------------------------------------------------------------------

console.log('\nChecking WASM claims are correctly qualified...');

const wasmLines = readmeText.split('\n').filter((l) => /WebAssembly/i.test(l));
const unqualified = wasmLines.filter((line) => {
  const lower = line.toLowerCase();
  const claimsAcceleration =
    lower.includes('accelerat') || lower.includes('high-performance');
  const isQualified =
    lower.includes('experimental') ||
    lower.includes('not bundled') ||
    lower.includes('capability') ||
    lower.includes('no compiled');
  return claimsAcceleration && !isQualified;
});

if (unqualified.length === 0) {
  pass('No unqualified WASM acceleration claims found');
} else {
  for (const line of unqualified) {
    fail(`Unqualified WASM acceleration claim: "${line.trim()}"`);
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\n' + '─'.repeat(60));

if (failures === 0) {
  console.log('\nAll documentation checks passed.\n');
  process.exit(0);
} else {
  console.error(`\n${failures} documentation check(s) failed.\n`);
  process.exit(1);
}

export {};
