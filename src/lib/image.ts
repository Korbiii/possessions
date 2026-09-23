import { THUMBNAIL_MAX_EDGE } from './constants';

/**
 * Image helpers. Written so that they work on the main thread *and* inside a
 * Web Worker (OffscreenCanvas when available, DOM canvas as a fallback).
 */

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToBlob(canvas: AnyCanvas, type: string, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type, quality });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas produced an empty image'))),
      type,
      quality,
    );
  });
}

/**
 * Resizes a photo to a small JPEG thumbnail (~300px longest edge) so that the
 * browsing UI stays fast (plan section 5, step 1).
 */
export async function createThumbnail(
  source: Blob,
  maxEdge: number = THUMBNAIL_MAX_EDGE,
): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d') as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null;
    if (!ctx) throw new Error('Could not acquire a 2D canvas context');
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0, width, height);
    return await canvasToBlob(canvas, 'image/jpeg', 0.8);
  } finally {
    bitmap.close?.();
  }
}

/** Reads a blob as a base64 data URL (used for the OpenRouter vision payload). */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') resolve(result);
      else reject(new Error('Could not read the photo as a data URL'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the photo'));
    reader.readAsDataURL(blob);
  });
}

/** Only photos the browser can actually decode should enter the queue. */
export function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  return /\.(jpe?g|png|webp|gif|avif|heic|heif|bmp|tiff)$/i.test(file.name);
}
