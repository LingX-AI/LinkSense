import type { BrowserStore } from "../src/modules/local-browser/store.js";

export class MemoryBrowserStore implements BrowserStore {
  readonly values = new Map<string, { value: string; until: number }>();
  async get(key: string): Promise<string | null> {
    const stored = this.values.get(key);
    return stored && stored.until > Date.now() ? stored.value : null;
  }
  async put(
    key: string,
    value: string,
    ttl: number,
    exclusive = false,
  ): Promise<boolean> {
    if (exclusive && (await this.get(key)) !== null) return false;
    this.values.set(key, { value, until: Date.now() + ttl });
    return true;
  }
  async take(key: string): Promise<string | null> {
    const value = await this.get(key);
    this.values.delete(key);
    return value;
  }
  async putIf(
    key: string,
    value: string,
    ttl: number,
    guard: string,
    expected: string,
  ): Promise<boolean> {
    if ((await this.get(guard)) !== expected) return false;
    return this.put(key, value, ttl);
  }
  async takeIf(
    key: string,
    guard: string,
    expected: string,
  ): Promise<string | null> {
    return (await this.get(guard)) === expected ? this.take(key) : null;
  }
  async touch(key: string, expected: string, ttl: number): Promise<boolean> {
    if ((await this.get(key)) !== expected) return false;
    return this.put(key, expected, ttl);
  }
  async remove(key: string, expected?: string): Promise<void> {
    if (expected === undefined || (await this.get(key)) === expected)
      this.values.delete(key);
  }
}
