// Presentation of the last received watch packet; GPS availability is separate.
export function watchUpdate(senior, now = Date.now()) {
  const timestamp = Date.parse(senior.positionAt);
  const age = now - timestamp;
  const valid = Number.isFinite(age) && age >= -5000;
  const fresh = valid && age <= 45000;
  const seconds = Math.max(0, Math.floor(age / 1000));
  const label = !valid ? 'No updates yet' : seconds < 5 ? 'Just now'
    : seconds < 60 ? `${seconds}s ago` : seconds < 3600 ? `${Math.floor(seconds / 60)} min ago`
      : seconds < 86400 ? `${Math.floor(seconds / 3600)} hr ago` : `${Math.floor(seconds / 86400)} days ago`;
  return { fresh, label, timestamp: valid ? timestamp : null };
}

export function readingValue(senior, field) {
  const value = senior[field];
  if (!Number.isFinite(Date.parse(senior.positionAt)) || !Number.isFinite(value)) return null;
  if (field === 'battery') return value >= 0 && value <= 100 ? value : null;
  return value > 0 && (field !== 'spo2' || value <= 100) ? value : null;
}

export function readingText(senior, field, unit = '') {
  const value = readingValue(senior, field);
  return value === null ? '—' : `${value}${unit}`;
}

export function readingStatus(senior, field, now) {
  const value = readingValue(senior, field);
  if (value === null) return { label: 'No reading', tone: 'muted' };
  if (!watchUpdate(senior, now).fresh) return { label: 'Last reading', tone: 'muted' };
  const review = field === 'pulse' ? value < 60 || value > 100 : field === 'spo2' ? value < 95 : value < 20;
  return { label: review ? 'Review' : 'In range', tone: review ? 'warning' : 'good' };
}

export function monitoringSummary(seniors, now) {
  const current = seniors.filter(senior => watchUpdate(senior, now).fresh);
  const average = field => {
    const values = current.map(senior => readingValue(senior, field)).filter(value => value !== null);
    return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  };
  const complete = current.length > 0 && current.every(senior => readingValue(senior, 'pulse') !== null && readingValue(senior, 'spo2') !== null);
  const review = current.some(senior => ['pulse', 'spo2'].some(field => readingStatus(senior, field, now).tone === 'warning'));
  return { online: current.length, offline: seniors.length - current.length, pulse: average('pulse'), spo2: average('spo2'),
    health: review ? 'Review' : complete ? 'In range' : 'Awaiting data', healthDetail: review ? 'Check the latest readings' : complete ? 'Current readings in range' : 'Waiting for current readings' };
}
