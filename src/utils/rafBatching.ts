/**
 * RequestAnimationFrame batching for ultra-low latency updates
 * Batches multiple updates into a single frame for optimal performance
 */
export class RAFBatching {
  private pendingUpdates = new Set<() => void>();
  private rafId: number | null = null;

  schedule(updateFn: () => void) {
    this.pendingUpdates.add(updateFn);
    
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => {
        this.flush();
      });
    }
  }

  private flush() {
    this.pendingUpdates.forEach(update => update());
    this.pendingUpdates.clear();
    this.rafId = null;
  }

  cancel() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pendingUpdates.clear();
  }
}

// Global instance for the app
export const rafBatching = new RAFBatching();
