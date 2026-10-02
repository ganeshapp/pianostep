/**
 * CPU time (user + system, in milliseconds) this test process spends running
 * `fn`, with its result. Complexity guards ("labels 20,000 measures at once")
 * use it instead of wall-clock time: on a busy machine (other test workers, a
 * CI runner) the process waits for a CPU and the wall clock runs on, but the
 * CPU time of the work itself stays the same. Vitest runs each test file in
 * its own worker process, so other files' work is not counted. If `fn`
 * throws, the error is passed on.
 */
export function withCpuMs<T>(fn: () => T): { result: T; ms: number } {
  const before = process.cpuUsage();
  const result = fn();
  const used = process.cpuUsage(before);
  return { result, ms: (used.user + used.system) / 1000 };
}

/** CPU time (ms) of `fn`; see withCpuMs. */
export function cpuMs(fn: () => void): number {
  return withCpuMs(fn).ms;
}
