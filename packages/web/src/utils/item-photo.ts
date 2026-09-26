import type { ItemPhotoMime } from '../api/client.js';

export const MAX_ITEM_PHOTO_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_PHOTO_BYTES = 20 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 40_000_000;
const MAX_EDGE = 1600;

export interface PreparedItemPhoto {
  readonly blob: Blob;
  readonly mimeType: ItemPhotoMime;
}

function supportedMime(file: File): ItemPhotoMime | null {
  if (file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'image/webp') {
    return file.type;
  }
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return null;
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) reject(new Error('浏览器无法处理这张图片，请换一张图片试试。'));
        else resolve(blob);
      },
      'image/webp',
      quality,
    );
  });
}

/** Decode, bound, and compress an item photo before sending it to the server. */
export async function prepareItemPhoto(file: File): Promise<PreparedItemPhoto> {
  if (file.size <= 0 || file.size > MAX_SOURCE_PHOTO_BYTES) {
    throw new Error('图片大小需在 1 B 到 20 MiB 之间。');
  }
  if (supportedMime(file) === null) {
    throw new Error('目前只支持 JPG、PNG 或 WEBP 图片。');
  }
  if (typeof createImageBitmap !== 'function') {
    throw new Error('当前浏览器不支持图片处理，请换用较新的浏览器。');
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('图片无法读取，请重新选择一张正常的图片。');
  }
  try {
    if (bitmap.width < 1 || bitmap.height < 1 || bitmap.width * bitmap.height > MAX_SOURCE_PIXELS) {
      throw new Error('图片尺寸不能超过 4000 万像素。');
    }

    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    let width = Math.max(1, Math.round(bitmap.width * scale));
    let height = Math.max(1, Math.round(bitmap.height * scale));

    for (let attempt = 0; attempt < 8; attempt += 1) {
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('浏览器无法处理这张图片，请换一张图片试试。');
      context.clearRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      const quality = Math.max(0.42, 0.88 - attempt * 0.08);
      const blob = await canvasBlob(canvas, quality);
      if (blob.type === 'image/webp' && blob.size <= MAX_ITEM_PHOTO_BYTES) {
        return { blob, mimeType: 'image/webp' };
      }
      width = Math.max(1, Math.floor(width * 0.82));
      height = Math.max(1, Math.floor(height * 0.82));
    }
  } finally {
    bitmap.close();
  }
  throw new Error('压缩后的图片仍然过大，请选择一张较小的图片。');
}
