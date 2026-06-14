import type { BackendEntry } from '../types';

export class Registry {
  private registry = new Map<string, BackendEntry>();
  private entriesByFile = new Map<string, Set<string>>();

  get(endpoint: string): BackendEntry | undefined {
    return this.registry.get(endpoint);
  }

  set(endpoint: string, entry: BackendEntry): void {
    this.registry.set(endpoint, entry);
  }

  delete(endpoint: string): void {
    this.registry.delete(endpoint);
  }

  has(endpoint: string): boolean {
    return this.registry.has(endpoint);
  }

  values(): IterableIterator<BackendEntry> {
    return this.registry.values();
  }

  get size(): number {
    return this.registry.size;
  }

  getEndpointsForFile(id: string): Set<string> {
    return this.entriesByFile.get(id) ?? new Set();
  }

  registerFile(id: string, endpoints: string[]): void {
    this.unregisterFile(id);
    this.entriesByFile.set(id, new Set(endpoints));
  }

  unregisterFile(id: string): void {
    const names = this.entriesByFile.get(id);
    if (!names) return;

    for (const endpoint of names) {
      if (this.registry.get(endpoint)?.file === id) {
        this.registry.delete(endpoint);
      }
    }

    this.entriesByFile.delete(id);
  }

  clear(): void {
    this.registry.clear();
    this.entriesByFile.clear();
  }
}
