import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ALLOWED_IMAGE_TYPES, validateImageInput } from "../adapters/label.js";

const extensions: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export interface StoredImage {
  managedName: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
}

export class ImageStorage {
  readonly directory: string;

  constructor(dataDir: string) {
    this.directory = path.join(dataDir, "images");
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true });
  }

  async save(input: { buffer: Buffer; mimeType: string; originalName: string }, maxBytes = 10 * 1024 * 1024): Promise<StoredImage> {
    validateImageInput(input, maxBytes);
    if (!ALLOWED_IMAGE_TYPES.has(input.mimeType)) throw new Error("Unsupported image type.");
    const managedName = `${randomUUID()}${extensions[input.mimeType]}`;
    await this.initialize();
    const destination = this.safePath(managedName);
    const temporary = `${destination}.tmp`;
    await fs.writeFile(temporary, input.buffer, { flag: "wx" });
    await fs.rename(temporary, destination);
    return { managedName, originalName: path.basename(input.originalName), mimeType: input.mimeType, byteSize: input.buffer.length };
  }

  async read(managedName: string): Promise<Buffer> {
    return fs.readFile(this.safePath(managedName));
  }

  async delete(managedName: string): Promise<void> {
    await fs.rm(this.safePath(managedName), { force: true });
  }

  safePath(managedName: string): string {
    if (!/^[0-9a-f-]+\.(?:jpg|png|webp|gif)$/.test(managedName)) throw new Error("Invalid managed image name.");
    const resolved = path.resolve(this.directory, managedName);
    if (!resolved.startsWith(`${path.resolve(this.directory)}${path.sep}`)) throw new Error("Invalid image path.");
    return resolved;
  }
}
