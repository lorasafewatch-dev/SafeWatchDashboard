import { isValidGpsPoint } from './gpsStatus.js';
import { familyZoneContains } from './familySafeZone.js';
import { withRequestTimeout } from './requestTimeout.js';

export function trustedHubAt(point, familyZone, hubs = []) {
  return familyZone ? null : hubs.find(hub => familyZoneContains(point, hub)) ?? null;
}

export function validateTrustedHub(draft) {
  const name = draft.name.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 80) throw new Error('Enter a safe hub name of up to 80 characters.');
  const lat = draft.lat === '' ? NaN : Number(draft.lat);
  const lng = draft.lng === '' ? NaN : Number(draft.lng);
  const radius = Number(draft.radius);
  if (!isValidGpsPoint({ lat, lng })) throw new Error('Choose the safe hub center on the map.');
  if (!Number.isInteger(radius) || radius < 10 || radius > 200) throw new Error('Choose a radius from 10 to 200 meters.');
  return { id: draft.id, name, lat, lng, radius };
}

export async function loadTrustedHubs(client) {
  const { data, error } = await withRequestTimeout(client.from('trusted_hubs')
    .select('id,name,lat,lng,radius').order('name').order('id'), 5000, 'Loading safe hubs took too long.');
  if (error) throw error;
  return data ?? [];
}

export async function addTrustedHub(client, draft) {
  const hub = validateTrustedHub(draft);
  const { error } = await withRequestTimeout(client.from('trusted_hubs')
    .upsert(hub, { onConflict: 'id', ignoreDuplicates: true }), 5000, 'Saving the safe hub took too long.');
  if (error) throw error;
  const { data, error: readError } = await withRequestTimeout(client.from('trusted_hubs')
    .select('id,name,lat,lng,radius').eq('id', hub.id).maybeSingle(), 5000, 'Verifying the saved safe hub took too long.');
  if (readError) throw readError;
  if (!data || Object.keys(hub).some(key => hub[key] !== data[key])) {
    throw new Error('The saved hub did not match this draft. Reload the map before trying again.');
  }
  return data;
}

export async function removeTrustedHub(client, id) {
  const { data, error } = await withRequestTimeout(client.from('trusted_hubs').delete().eq('id', id).select('id'),
    5000, 'Removing the safe hub took too long.');
  if (error) throw error;
  if (!data?.some(row => row.id === id)) throw new Error('The safe hub was already removed or your account can no longer remove it.');
}
