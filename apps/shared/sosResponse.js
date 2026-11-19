export function isFamilyActionable(incident) {
  return incident.alert_type !== 'SOS' || incident.details?.sos_assigned_to !== 'barangay';
}

export function sosResponseState(incident) {
  const details = incident?.details || {};
  const responses = { ...details.sos_responses };
  // Preserve indicators for confirmations saved before the handoff update.
  if (!responses.family && details.status === 'ACKNOWLEDGED_FAMILY') responses.family = { decision: 'confirmed', at: details.acknowledged_at };
  if (!responses.barangay && details.status === 'ACKNOWLEDGED_BHW') responses.barangay = { decision: 'confirmed', at: details.acknowledged_at };
  const confirmed = ['ACKNOWLEDGED_FAMILY','ACKNOWLEDGED_BHW'].includes(details.status);
  const assigned = details.sos_assigned_to;
  const transferred = !!details.sos_transferred_at;
  const waitingForFamily = details.sos_family_first === true && !transferred && !confirmed
    && details.incident_open !== false && ['PENDING_FAMILY','ESCALATED_BHW'].includes(details.status || 'PENDING_FAMILY');
  const message = confirmed ? details.status === 'ACKNOWLEDGED_FAMILY' ? 'Family confirmed the response' : 'Barangay secretary confirmed the response'
    : waitingForFamily ? 'Waiting for family response'
    : assigned === 'both' ? 'Both sides declined. SOS still needs a response.'
    : assigned === 'barangay' && details.sos_transfer_reason === 'automatic_timeout' ? 'No family response after 3 minutes. Barangay notified.'
    : assigned === 'barangay' && details.sos_transfer_reason === 'family_unavailable' ? 'SOS transferred to barangay. Waiting for a response.'
    : assigned === 'barangay' ? 'Family declined. Barangay secretary notified.'
    : assigned === 'family' ? 'Barangay secretary declined. Family notified.' : 'Awaiting a response';
  return { responses, confirmed, assigned, message, transferred, waitingForFamily };
}

export function sosTransferLabel(incident) {
  const reason = incident?.details?.sos_transfer_reason;
  if (reason === 'automatic_timeout') return 'Automatic transfer · No family response after 3 minutes';
  if (reason === 'family_unavailable') return 'Transferred by family';
  if (reason === 'family_request' || incident?.details?.source === 'family_app') return 'Family requested assistance';
  return '';
}

export async function respondToSos(client, incident, decision, role = 'family') {
  if (incident?.alert_type !== 'SOS' || !['confirmed','declined'].includes(decision) || !['family','barangay'].includes(role)) throw new Error('Invalid SOS response');
  const { data, error } = await client.rpc('respond_to_sos', { p_alert_id: incident.id, p_decision: decision, p_role: role });
  if (error) throw error;
  if (data?.saved !== true || String(data.alert?.id) !== String(incident.id)
    || data.alert?.alert_type !== 'SOS' || data.alert?.device_id !== incident.device_id) throw new Error('This SOS changed. Refresh and try again.');
  return { ...data.alert, devices: incident.devices };
}

export async function loadSosResponses(client) {
  const { data, error } = await client.rpc('list_sos_response_updates', { p_limit: 50 });
  if (error) throw error;
  return (data || []).map(row => ({ ...row, devices: { patient_name: row.patient_name } }));
}

export function mergeSosResponse(previous, incoming) {
  return [incoming, ...previous.filter(row => String(row.id) !== String(incoming.id))].slice(0,50);
}

export function sosResponseError(error) {
  if (['PGRST202','42883'].includes(error?.code)) return 'SOS responses need the SafeWatch database update. The alert remains active.';
  if (['42501','PGRST301'].includes(error?.code)) return 'Your session cannot save this SOS response. Sign in again. The alert remains active.';
  if (error?.code === '40001') return 'This SOS has already changed. Check its latest response before trying again.';
  return 'The SOS response could not be saved. The alert remains active. Please try again.';
}
