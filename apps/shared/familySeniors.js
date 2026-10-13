export function normalizeWatchId(value) {
  let id = String(value || '').replace(/\s+/g, '').toLowerCase();
  if (/^[a-f0-9]{32}$/.test(id)) id = `${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) {
    throw new Error('Enter the complete Watch ID shown on the watch, including all 36 characters.');
  }
  return id;
}

export function seniorDetails(device) {
  const parts = String(device.device_name || '').replace(/\s*\[MUTED\]/g, '').trim().split(' (');
  const oldAge = parts[2] ? Number(parts[2].replace(')', '').trim()) : null;
  return { ...device, age: device.age ?? (Number.isInteger(oldAge) ? oldAge : null),
    gender: device.gender || (parts[1] ? parts[1].replace(')', '').trim() : 'Not specified') };
}

export function chooseFamilySenior(seniors, preferredId) {
  return seniors.some(senior => senior.id === preferredId) ? preferredId : seniors[0]?.id || null;
}

export async function loadFamilySeniors(client, userId) {
  if (!userId) return [];
  const { data, error } = await client.from('family_seniors')
    .select('device_id, created_at, devices(id, patient_name, device_name, age, gender)')
    .eq('user_id', userId).order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).filter(row => row.devices && row.devices.patient_name !== '[HIDDEN]')
    .map(row => seniorDetails(row.devices));
}

export async function loadRegisteredSeniors(client) {
  const { data, error } = await client.from('devices').select('id, patient_name, device_name, age, gender')
    .neq('patient_name', '[HIDDEN]').order('patient_name', { ascending: true }).limit(1000);
  if (error) throw error;
  return (data || []).map(seniorDetails);
}

export async function linkFamilySenior(client, watchId) {
  const id = normalizeWatchId(watchId);
  const { data, error } = await client.rpc('link_family_senior', { p_device_id: id });
  if (error) throw error;
  if (data !== id) throw new Error('The senior link could not be verified. Please refresh your list.');
  return id;
}

export async function registerFamilySenior(client, draft) {
  const id = normalizeWatchId(draft.watchId);
  const name = String(draft.name || '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 100 || name === '[HIDDEN]') throw new Error('Enter the senior’s full name, up to 100 characters.');
  const age = draft.age === '' || draft.age == null ? null : Number(draft.age);
  if (age !== null && (!Number.isInteger(age) || age < 0 || age > 130)) throw new Error('Enter an age from 0 to 130, or leave it blank.');
  const gender = draft.gender || 'Not specified';
  if (!['Male','Female','Other','Not specified'].includes(gender)) throw new Error('Choose a valid gender.');
  const { data, error } = await client.rpc('register_family_senior', { p_device_id: id, p_name: name, p_age: age, p_gender: gender });
  if (error) throw error;
  if (data !== id) throw new Error('The registration could not be verified. Please refresh your list.');
  return id;
}

export async function unlinkFamilySenior(client, watchId) {
  const { data, error } = await client.rpc('unlink_family_senior', { p_device_id: normalizeWatchId(watchId) });
  if (error) throw error;
  if (data !== true) throw new Error('The senior could not be removed from your list. Please try again.');
}

export function seniorManagementError(error) {
  if (['PGRST202','PGRST205','42P01','42703'].includes(error?.code)) return 'Senior management is unavailable. Please ask your administrator to complete the database update.';
  if (error?.code === '23505') return 'This Watch ID is already registered. Choose Link existing senior instead.';
  if (['42501','PGRST301'].includes(error?.code)) return 'Please sign in again before changing your senior list.';
  return error?.message || 'Your senior list could not be updated. Please try again.';
}
