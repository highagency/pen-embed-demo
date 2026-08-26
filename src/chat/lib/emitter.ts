/** Tiny subscription helper used by the singleton stores. */
export class Emitter {
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  emit() {
    for (const listener of [...this.listeners]) listener();
  }
}
