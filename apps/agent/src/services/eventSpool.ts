import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { NetworkEventInput } from "../types/index.js";

const MAX_EVENTS = 10_000;
const RETENTION_MS = 24 * 60 * 60 * 1000;

export class EventSpool {
  private events: NetworkEventInput[] = [];
  private loaded = false;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as NetworkEventInput[];
      if (Array.isArray(parsed)) this.events = parsed.filter((event) => Date.parse(event.occurredAt) >= Date.now() - RETENTION_MS);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Agent event spool could not be read");
    }
  }

  private async persist() {
    const temporary = `${this.path}.tmp`;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(temporary, JSON.stringify(this.events), { mode: 0o600 });
    await rename(temporary, this.path);
  }

  private async save() {
    const operation = this.writing.then(() => this.persist());
    this.writing = operation.catch(() => undefined);
    await operation;
  }

  async enqueue(events: NetworkEventInput[]) {
    await this.load();
    this.events.push(...events);
    if (this.events.length > MAX_EVENTS) this.events = this.events.slice(-MAX_EVENTS);
    await this.save();
  }

  async take(limit: number) {
    await this.load();
    return this.events.slice(0, limit);
  }

  async acknowledge(count: number) {
    await this.load();
    this.events.splice(0, count);
    await this.save();
  }

  async size() {
    await this.load();
    return this.events.length;
  }
}
