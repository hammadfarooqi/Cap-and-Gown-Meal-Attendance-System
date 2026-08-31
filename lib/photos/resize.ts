import { PHOTO_WIDTH, PHOTO_HEIGHT, PHOTO_QUALITY } from "./naming";

/**
 * Resize and re-encode a headshot in the browser, before it is uploaded.
 *
 * Doing this client-side rather than on the server keeps a heavy image
 * library out of the dependency list and off a serverless function's memory
 * budget — and a 300-photo upload sends about 12MB instead of several
 * hundred, over club Wi-Fi.
 *
 * A 4:5 portrait cropped from the TOP, not a square cropped from the centre.
 *
 * The originals are 857x1200. Centre-cropping that to a square cut 171px off
 * the top, which in a posed headshot is the top of somebody's head — visible
 * on the real photos once they arrived. Cropping from the top keeps the head
 * whole and drops the jacket instead.
 */
export async function resizeHeadshot(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);

  try {
    // The widest 4:5 box that fits, anchored at the top edge.
    const ratio = PHOTO_WIDTH / PHOTO_HEIGHT;
    const sw = Math.min(bitmap.width, bitmap.height * ratio);
    const sh = sw / ratio;
    const sx = (bitmap.width - sw) / 2;
    const sy = 0;

    const canvas = document.createElement("canvas");
    canvas.width = PHOTO_WIDTH;
    canvas.height = PHOTO_HEIGHT;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not read this image.");

    context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, PHOTO_WIDTH, PHOTO_HEIGHT);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode this image."))),
        "image/webp",
        PHOTO_QUALITY,
      );
    });
  } finally {
    bitmap.close();
  }
}
