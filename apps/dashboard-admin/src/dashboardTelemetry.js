import { telemetryTimestamp } from '../../shared/gpsStatus.js';
import { withRequestTimeout } from '../../shared/requestTimeout.js';

export function latestDashboardPacket(existing, incoming) {
  const incomingAt = Date.parse(telemetryTimestamp(incoming));
  if (!Number.isFinite(incomingAt) || incomingAt > Date.now() + 5000) return existing ?? null;
  const existingAt = Date.parse(telemetryTimestamp(existing));
  if (!Number.isFinite(existingAt) || incomingAt > existingAt) return incoming;
  if (incomingAt === existingAt && Number(incoming.id) > Number(existing.id)) return incoming;
  return existing;
}

export async function loadDashboardWatches(client) {
  const { data, error } = await withRequestTimeout(client.rpc('get_dashboard_watch_snapshot'), 5000,
    'Loading the watch snapshot took too long.');
  if (!error && Array.isArray(data)) return data;
  if (error && !['PGRST202', '42883'].includes(error.code)) throw error;

  // Older SafeWatch databases still support the original authorized table reads.
  const { data: devices, error: deviceError } = await withRequestTimeout(client.from('devices').select('*'), 5000,
    'Loading watches took too long.');
  if (deviceError) throw deviceError;
  return Promise.all((devices ?? []).filter(device => device.patient_name !== '[HIDDEN]').map(async device => {
    const { data: packets, error: packetError } = await withRequestTimeout(client.from('telemetry').select('*')
      .eq('device_id', device.id).order('created_at', { ascending: false }).limit(20), 5000,
    'Loading the latest watch packets took too long.');
    if (packetError) throw packetError;
    return { device, packet: (packets ?? []).reduce(latestDashboardPacket, null) };
  }));
}
