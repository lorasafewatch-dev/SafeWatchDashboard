import { alertTitle, batteryAlertMessage } from './alertLifecycle.js';
import { sosResponseState } from './sosResponse.js';

const terminal = row => ['ACKNOWLEDGED_FAMILY','ACKNOWLEDGED_BHW'].includes(row.details?.status);
const version = row => Number(row.details?.sos_response_version) || 0;
const entity = row => `${row.device_id}:${row.alert_type}:${row.id}`;
const time = value => Date.parse(value) || 0;

export function buildBellNotifications(active = [], responses = [], userId = null) {
  const rows = new Map(active.map(incident => [entity(incident), { incident, active: true }]));
  for (const receipt of responses) {
    const key = entity(receipt);
    const existing = rows.get(key);
    if (!existing || version(receipt) > version(existing.incident)
      || version(receipt) === version(existing.incident) && terminal(receipt)) {
      rows.set(key, { incident: receipt, active: false });
    }
  }
  return [...rows.values()].map(({ incident, active: needsResponse }) => {
    const details = incident.details || {};
    const response = sosResponseState(incident);
    const isSos = incident.alert_type === 'SOS';
    const isUpdate = isSos && (!!details.sos_response_at || terminal(incident));
    const at = isUpdate ? details.sos_response_at || details.acknowledged_at || incident.created_at
      : details.first_seen_at || incident.created_at;
    const decisions = Object.values(response.responses).filter(Boolean);
    const latestDecision = decisions.find(item => item.at && item.at === details.sos_response_at)
      || decisions.sort((a,b) => time(b.at)-time(a.at))[0];
    const confirmer = details.status === 'ACKNOWLEDGED_BHW' ? response.responses.barangay : response.responses.family;
    const actor = terminal(incident) ? details.acknowledged_by || confirmer?.by || latestDecision?.by : latestDecision?.by;
    const revision = version(incident) ? `response:${version(incident)}`
      : isUpdate ? `confirmation:${details.status}:${at}` : `initial:${details.first_seen_at || incident.created_at}`;
    return { key: `${entity(incident)}:${revision}`, incident, active: needsResponse,
      title: needsResponse ? alertTitle(incident) : response.message,
      message: isSos && (isUpdate || response.assigned) ? response.message
        : incident.alert_type === 'LOW_BATTERY' ? batteryAlertMessage(incident)
        : isSos ? 'An SOS needs a response.' : 'The senior left the safe zone.',
      name: incident.devices?.patient_name || incident.seniorName || 'Linked senior', at,
      autoRead: !!userId && actor === userId,
    };
  }).sort((a,b) => Number(b.active)-Number(a.active)
    || Number(b.active && b.incident.alert_type === 'SOS')-Number(a.active && a.incident.alert_type === 'SOS')
    || time(b.at)-time(a.at));
}

export function notificationStorageKey(app, userId) {
  return ['family','barangay'].includes(app) && userId ? `safewatch.${app}.notifications.v1:${userId}` : null;
}

const validIds = values => Array.isArray(values) ? values.filter(value => typeof value === 'string' && value.length <= 600).slice(-2048) : [];

export function loadReadNotifications(storage, key) {
  if (!key) return [];
  try { return validIds(JSON.parse(storage?.getItem(key) || '[]')); } catch { return []; }
}

export function markNotificationsRead(previous, keys, storage, storageKey) {
  const next = [...new Set([...validIds(previous), ...validIds(keys)])].slice(-2048);
  if (storageKey) { try { storage?.setItem(storageKey, JSON.stringify(next)); } catch { /* Reading still works without browser storage. */ } }
  return next;
}

export function unreadNotifications(notifications, readIds = []) {
  const read = new Set(readIds);
  return notifications.filter(item => !item.autoRead && !read.has(item.key));
}
