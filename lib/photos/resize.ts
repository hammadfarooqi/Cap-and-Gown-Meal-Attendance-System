import { PHOTO_EDGE, PHOTO_QUALITY } from "./naming";

/**
 * Resize and re-encode a headshot in the browser, before it is uploaded.
 *
 * Doing this client-side rather than on the server keeps a heavy image
 * library out of the dependency list and off a serverless function's memory
 * budget — and a 300-photo upload sends about 12MB instead of several
 * hundred, over club Wi-Fi.
 *
 * Square crop from the centre, because the station renders a circle and an
 * off-centre crop takes the top of somebody's head off.
 */
export async function resizeHeadshot(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);

  try {
    const edge = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - edge) / 2;
    const sy = (bitmap.height - edge) / 2;

    const canvas = document.createElement("canvas");
    canvas.width = PHOTO_EDGE;
    canvas.height = PHOTO_EDGE;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not read this image.");

    context.drawImage(bitmap, sx, sy, edge, edge, 0, 0, PHOTO_EDGE, PHOTO_EDGE);

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
