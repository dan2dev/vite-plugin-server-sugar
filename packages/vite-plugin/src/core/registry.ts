import type { ServerEntry } from '../types';

export class Registry<T extends { file: string } = ServerEntry> {
  private registry = new Map<string, T>();
  private entriesByFile = new Map<string, Set<string>>();

  get(endpoint: string): T | undefined {
    return this.registry.get(endpoint);
  }

  set(endpoint: string, entry: T): void {
    this.registry.set(endpoint, entry);
  }

  delete(endpoint: string): void {
    this.registry.delete(endpoint);
  }

  has(endpoint: string): boolean {
    return this.registry.has(endpoint);
  }

  values(): IterableIterator<T> {
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
