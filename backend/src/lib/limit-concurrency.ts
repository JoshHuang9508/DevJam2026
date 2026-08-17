/**
 * FIFO concurrency gate.
 *
 * Written for the urban-planning GIS adapters, where one coordinate lookup naturally fans out into
 * eight or so spatial queries (two radii × zoning, plus the plan index and four thematic layers).
 * Issued all at once, these servers degrade badly: a 45 m envelope query that answers in ~0.3s on
 * its own was measured exceeding a 15-second timeout when fired alongside seven siblings. Capping
 * in-flight requests keeps each one fast and is politer to the upstream service.
 *
 * Only wrap leaf HTTP calls. Wrapping a function that itself awaits a limited call would deadlock
 * once the outer call holds the last slot.
 */
export type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

export function createLimiter(maxConcurrent: number): Limiter {
  let active = 0;
  const waiting: Array<() => void> = [];

  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    if (active >= maxConcurrent) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}
