import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readProviderPhotoJpeg } from './media.service.js';

let tempDir = '';

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'postyar-media-'));
  process.env.STORAGE_DIR = tempDir;
});

afterEach(async () => {
  delete process.env.STORAGE_DIR;
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

describe('provider photo representation', () => {
  it('converts an image to JPEG only at provider-delivery time', async () => {
    const png = await sharp({
      create: { width: 20, height: 12, channels: 3, background: { r: 255, g: 0, b: 0 } },
    }).png().toBuffer();
    const relative = 'tenant/source.webp';
    await fs.mkdir(path.join(tempDir, 'tenant'), { recursive: true });
    await fs.writeFile(path.join(tempDir, relative), png);

    const jpeg = await readProviderPhotoJpeg({
      id: '01J00000000000000000000000',
      tenantId: '01J00000000000000000000000',
      filename: 'source.webp',
      mime: 'image/webp',
      sizeBytes: png.length,
      width: 20,
      height: 12,
      checksum: 'x'.repeat(64),
      storagePath: relative,
      createdAt: new Date(),
    } as never);

    const meta = await sharp(jpeg).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(20);
    expect(meta.height).toBe(12);
  });
});
