interface BenchmarkResult {
  name: string;
  runs: number;
  average: number;
  min: number;
  max: number;
  median: number;
  stdDev: number;
}

export async function benchmark(
  name: string,
  fn: () => void | Promise<void>,
  runs = 1000,
): Promise<BenchmarkResult> {
  const times: number[] = [];

  // Warmup
  for (let i = 0; i < Math.min(10, runs / 10); i++) {
    await fn();
  }

  // Actual benchmark
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await fn();
    const end = performance.now();
    times.push(end - start);
  }

  times.sort((a, b) => a - b);

  const sum = times.reduce((acc, time) => acc + time, 0);
  const average = sum / runs;
  const min = times[0] ?? 0;
  const max = times[times.length - 1] ?? 0;
  const median = times[Math.floor(runs / 2)] ?? 0;

  const variance =
    times.reduce((acc, time) => acc + Math.pow(time - average, 2), 0) / runs;
  const stdDev = Math.sqrt(variance);

  return {
    name,
    runs,
    average,
    min,
    max,
    median,
    stdDev,
  };
}

export function formatBenchmarkResult(result: BenchmarkResult): string {
  return `
Benchmark: ${result.name}
Runs: ${result.runs}
Average: ${result.average.toFixed(3)}ms
Min: ${result.min.toFixed(3)}ms
Max: ${result.max.toFixed(3)}ms
Median: ${result.median.toFixed(3)}ms
Std Dev: ${result.stdDev.toFixed(3)}ms
`.trim();
}

export async function compareBenchmarks(
  benchmarks: Array<{ name: string; fn: () => void | Promise<void> }>,
  runs = 1000,
): Promise<void> {
  console.log('Running benchmarks...\n');

  const results = await Promise.all(
    benchmarks.map(({ name, fn }) => benchmark(name, fn, runs)),
  );

  results.sort((a, b) => a.average - b.average);

  const fastest = results[0];

  results.forEach((result, index) => {
    console.log(formatBenchmarkResult(result));
    if (index > 0 && fastest) {
      const slower = ((result.average / fastest.average - 1) * 100).toFixed(1);
      console.log(`(${slower}% slower than ${fastest.name})`);
    }
    console.log('');
  });
}
