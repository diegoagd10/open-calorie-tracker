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

export function assertSafeManagedImageName(managedName: string): void {
  if (!/^[0-9a-f-]+\.(?:jpg|png|webp|gif)$/.test(managedName)) throw new Error("Invalid managed image name.");
}

export function safeManagedImagePath(directory: string, managedName: string): string {
  assertSafeManagedImageName(managedName);
  const resolvedDirectory = path.resolve(directory);
  const resolved = path.resolve(resolvedDirectory, managedName);
  if (!resolved.startsWith(`${resolvedDirectory}${path.sep}`)) throw new Error("Invalid image path.");
  return resolved;
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
    return safeManagedImagePath(this.directory, managedName);
  }
}
