export interface MonotonicProgressReporter {
  report: (progress: number) => void;
  flush: () => Promise<void>;
  current: () => number;
}

function normalizeProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(100, Math.max(0, Math.round(progress)));
}

export function createMonotonicProgressReporter(
  initialProgress: number,
  persist: (progress: number) => Promise<void>,
): MonotonicProgressReporter {
  let highest = normalizeProgress(initialProgress);
  let pending = Promise.resolve();

  return {
    report(progress) {
      const next = Math.max(highest, normalizeProgress(progress));
      if (next === highest) return;
      highest = next;
      pending = pending
        .catch(() => undefined)
        .then(() => persist(next))
        .catch(() => undefined);
    },
    flush() {
      return pending;
    },
    current() {
      return highest;
    },
  };
}
