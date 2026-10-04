import { File } from 'expo-file-system';

import { supabase } from '@/lib/supabase';
import { generateId } from '@/lib/id';

// Uploads one local image to the private "photos" bucket and inserts its photos row.
// Path format: {adventure_id}/{stop_id}/{id}.{ext}. Throws on failure.
export async function uploadStopPhoto(params: {
  adventureId: string;
  stopId: string;
  userId: string;
  uri: string;
  mimeType?: string | null;
}): Promise<void> {
  const { adventureId, stopId, userId, uri, mimeType } = params;
  const ext = uri.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `${adventureId}/${stopId}/${generateId()}.${ext}`;

  // Reading via expo-file-system's File class (not global fetch) avoids a known RN/Hermes
  // issue where fetch(uri).arrayBuffer() on a local file:// URI silently returns truncated
  // or empty data, producing a broken image once uploaded.
  const arrayBuffer = await new File(uri).arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from('photos')
    .upload(path, arrayBuffer, { contentType: mimeType ?? 'image/jpeg' });
  if (uploadError) throw uploadError;

  const { error: insertError } = await supabase.from('photos').insert({
    adventure_id: adventureId,
    stop_id: stopId,
    user_id: userId,
    storage_path: path,
  });
  if (insertError) throw insertError;
}
