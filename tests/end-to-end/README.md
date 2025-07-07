# End-to-End Browser Tests

This directory contains Playwright end-to-end tests that verify the vector database works correctly in real browser environments.

## Test Coverage

### 🚀 Basic Operations (`basic-operations.spec.ts`)

- Database initialization and cleanup
- CRUD operations (Create, Read, Update, Delete)
- Vector search with different distance metrics
- Batch operations performance
- Error handling

### 💾 IndexedDB Storage (`indexeddb-storage.spec.ts`)

- Data persistence across page reloads
- Large vector storage and retrieval
- Database versioning and migrations
- Concurrent operations
- Storage quota and cleanup
- Error recovery

### 👷 Web Workers (`web-workers.spec.ts`)

- Web Worker support detection
- Worker pool operations
- SharedArrayBuffer functionality
- Worker error handling and termination

### ⚡ WASM Operations (`wasm-operations.spec.ts`)

- WebAssembly support detection
- WASM module compilation and instantiation
- Memory operations
- Vector operations in WASM
- Error handling and performance testing

### 🌐 Cross-Browser Compatibility (`cross-browser-compatibility.spec.ts`)

- Testing across Chrome, Firefox, Safari
- Mobile device testing (iPhone, Android)
- Browser capability detection
- Storage limits and performance differences
- API compatibility across browsers

## Running Tests

### Local Development

```bash
# Run all end-to-end tests
bun run test:end-to-end

# Run with UI (interactive mode)
bun run test:end-to-end:ui

# Run in headed mode (see browser)
bun run test:end-to-end:headed

# Run specific browser
bun run test:end-to-end:chromium
bun run test:end-to-end:firefox
bun run test:end-to-end:webkit

# Run mobile tests
bun run test:end-to-end:mobile

# Run all tests (unit + end-to-end)
bun run test:all
```

### Individual Test Files

```bash
# Run specific test file
bunx playwright test tests/end-to-end/basic-operations.spec.ts

# Run specific test
bunx playwright test -g "should perform CRUD operations"

# Debug mode
bunx playwright test --debug
```

## Test Environment

### Server Setup

- Tests run against a local Bun server (`server.ts`)
- Server serves built files from `dist/` directory
- Cross-origin isolation headers for SharedArrayBuffer support
- Static file serving for test assets

### Browser Configuration

- **Chromium**: Full feature testing including SharedArrayBuffer
- **Firefox**: Standard web APIs, some limitations
- **WebKit/Safari**: Conservative testing, stricter security
- **Mobile**: Memory-constrained testing, touch interactions

### Test Data

- Vector dimensions: Typically 384 for realistic embeddings
- Test vectors: Random or structured data for consistent results
- Metadata: Various types to test filtering and storage
- Performance: Batch sizes from 10-100 vectors for reasonable test times

## Browser-Specific Considerations

### Chrome/Chromium

- Full SharedArrayBuffer support with proper headers
- WebGPU support (where available)
- Best WASM performance
- Generous storage quotas

### Firefox

- Standard web APIs
- Good IndexedDB performance
- Limited SharedArrayBuffer (requires headers)
- Memory monitoring via performance.memory not available

### Safari/WebKit

- Stricter security policies
- Limited SharedArrayBuffer support
- Different storage quota behavior
- May require fallbacks for some APIs

### Mobile Browsers

- Memory constraints require smaller test vectors
- Touch-specific interactions
- Battery optimization affects performance
- Storage limits more restrictive

## Test Structure

Each test file follows this pattern:

```typescript
test.describe('Feature Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should test specific functionality', async ({ page }) => {
    // Initialize database
    await page.click('#init-db');
    await expect(page.locator('#db-status')).toContainText('Initialized');

    // Run test logic in browser context
    await page.evaluate(async () => {
      // Test implementation
      window.addTestResult('Test Name', 'success', 'Details');
    });

    // Verify results
    await expect(page.locator('#test-results')).toContainText('Test Name: SUCCESS');
  });
});
```

## Debugging Tests

### Browser DevTools

```bash
# Open browser with DevTools
bunx playwright test --headed --slowMo=1000
```

### Screenshots and Videos

- Automatic screenshots on failure
- Videos for failed tests
- Traces for debugging (stored in `test-results/`)

### Logging

- Browser console logs captured automatically
- Custom logging via `window.log()` function
- Test results displayed in both browser and test output

## Performance Benchmarks

Tests include performance measurements:

- **Vector Addition**: < 10ms per vector average
- **Search Operations**: < 100ms for 100 vectors
- **Batch Operations**: 50-100 vectors in reasonable time
- **Memory Usage**: Monitored via Storage API where available

## CI/CD Integration

### GitHub Actions

- Runs on `ubuntu-latest` with multiple browser matrix
- Separate job for mobile testing
- Artifacts uploaded on failure
- Cross-browser compatibility verified

### Local CI Testing

```bash
# Simulate CI environment
CI=true bunx playwright test
```

## Troubleshooting

### Common Issues

1. **SharedArrayBuffer not available**

   - Check COOP/COEP headers in server.ts
   - Some browsers require HTTPS in production

2. **WASM compilation failures**

   - Normal for complex modules in some browsers
   - Tests include fallback mechanisms

3. **IndexedDB quota exceeded**

   - Tests clean up after themselves
   - Clear browser data if issues persist

4. **Worker errors**
   - Check for Content-Security-Policy restrictions
   - Verify worker script syntax

### Debug Commands

```bash
# Check server is running
curl http://localhost:8201

# View browser capabilities
bunx playwright test --headed --grep "capabilities"

# Test specific browser
bunx playwright test --project=firefox --grep "basic"
```
