// File storage behind a minimal adapter so dev uses local disk and prod can
// swap in any S3-compatible bucket without touching callers. Bytes live in
// the backend; metadata lives in the StoredFile table.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { prisma } from '@/lib/db';

export interface StorageBackend {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

class LocalDiskBackend implements StorageBackend {
  constructor(private root: string) {}

  private resolve(key: string): string {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) {
      throw new Error('Invalid storage key');
    }
    return p;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const p = this.resolve(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }
}

// S3 adapter slots in here when bucket credentials exist (STORAGE_DRIVER=s3).
export const storage: StorageBackend = new LocalDiskBackend(
  process.env.STORAGE_LOCAL_ROOT ?? path.join(process.cwd(), 'uploads'),
);

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
]);

export async function storeUpload(opts: {
  businessId: string;
  filename: string;
  mimeType: string;
  data: Buffer;
}) {
  if (!ALLOWED_MIME.has(opts.mimeType)) {
    throw new Error(`Unsupported file type: ${opts.mimeType}`);
  }
  if (opts.data.length > 15 * 1024 * 1024) {
    throw new Error('File too large (15 MB max).');
  }
  const key = `${opts.businessId}/${randomUUID()}`;
  await storage.put(key, opts.data);
  return prisma.storedFile.create({
    data: {
      businessId: opts.businessId,
      key,
      filename: opts.filename,
      mimeType: opts.mimeType,
      size: opts.data.length,
    },
  });
}
