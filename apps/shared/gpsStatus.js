// An instrumented gateway must have an RF time, even when cloud insertion is recent.
export function telemetryTimestamp(record) {
  if (!record) return null;
  if (record.received_at) return record.received_at;
  if (record.rx_uptime_ms !== undefined && record.rx_uptime_ms !== null) return null;
  return record.created_at || null; // Legacy telemetry has no separate RF time.
}

export function isValidGpsPoint(point) {
  return !!point && Number.isFinite(point.lat) && Number.isFinite(point.lng) &&
    Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180 &&
    !(point.lat === 0 && point.lng === 0);
}

// Watch sends telemetry every 10s. Allow three missed packets plus gateway latency.
export function isCurrentGpsPoint(point, timestamp, now = Date.now()) {
  if (!isValidGpsPoint(point)) return false;
  const age = now - Date.parse(timestamp);
  return Number.isFinite(age) && age >= -5000 && age <= 45000;
}
