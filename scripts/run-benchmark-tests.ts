import { $ } from 'bun';

const benchmarkGlob = new Bun.Glob('**/*.benchmark.test.ts');
const benchmarkPaths: string[] = [];
const benchmarkRoots = ['src', 'tests'];

for (const root of benchmarkRoots) {
  for await (const path of benchmarkGlob.scan(root)) {
    benchmarkPaths.push(`./${root}/${path}`);
  }
}

benchmarkPaths.sort();

if (benchmarkPaths.length === 0) {
  console.error('No benchmark tests found.');
  process.exit(1);
}

await $`bun test --timeout 120000 ${benchmarkPaths}`;
