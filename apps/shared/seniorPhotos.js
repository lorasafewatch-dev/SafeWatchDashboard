export const PHOTO_BUCKET = 'senior-photos';
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
export async function validateSeniorPhoto(file) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG, or WebP photo.');
  if (!file.size || file.size > MAX_PHOTO_BYTES) throw new Error('Choose a photo up to 2 MB.');
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = [137,80,78,71,13,10,26,10].every((byte, i) => bytes[i] === byte);
  const webp = String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP';
  if (!(file.type === 'image/jpeg' && jpeg || file.type === 'image/png' && png || file.type === 'image/webp' && webp)) throw new Error('This file is not a valid photo.');
}

export async function prepareSeniorPhoto(file) {
  await validateSeniorPhoto(file);
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('This photo could not be read. Choose another image.'); }
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 20000000) throw new Error('Choose a photo no larger than 20 megapixels.');
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // Re-encode a decoded bitmap: strip GPS/EXIF metadata and reject active formats.
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.85));
    if (!blob || blob.size > MAX_PHOTO_BYTES) throw new Error('This photo could not be prepared. Choose a smaller image.');
    return blob;
  } finally { bitmap.close(); }
}

export async function saveSeniorPhoto(client, deviceId, file) {
  const photo = await prepareSeniorPhoto(file);
  const path = `${deviceId}/${crypto.randomUUID()}.webp`;
  const { error } = await client.storage.from(PHOTO_BUCKET).upload(path, photo, { contentType: 'image/webp', upsert: false });
  if (error) throw error;
  const { data, error: saveError } = await client.rpc('set_senior_photo', { p_device_id: deviceId, p_path: path });
  if (saveError) {
    // Only clean up a definitely rejected write. A lost response may already have
    // committed the pointer, so deleting that object could erase a saved photo.
    if (['22023', '42501', 'PGRST202', '42883'].includes(saveError.code)) await client.storage.from(PHOTO_BUCKET).remove([path]).catch(() => {});
    throw saveError;
  }
  if (data?.photo_path !== path) throw new Error('The saved photo could not be verified. Refresh this senior before retrying.');
  if (data?.previous_path && data.previous_path !== path) await client.storage.from(PHOTO_BUCKET).remove([data.previous_path]).catch(() => {});
  return path;
}

export async function removeSeniorPhoto(client, deviceId) {
  const { data, error } = await client.rpc('set_senior_photo', { p_device_id: deviceId, p_path: null });
  if (error) throw error;
  if (data?.photo_path !== null) throw new Error('Photo removal could not be verified. Refresh this senior before retrying.');
  if (data?.previous_path) await client.storage.from(PHOTO_BUCKET).remove([data.previous_path]).catch(() => {});
}
