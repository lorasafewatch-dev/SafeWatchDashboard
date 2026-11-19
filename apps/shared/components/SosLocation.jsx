import { useEffect, useState } from 'react';
import { isValidGpsPoint } from '../gpsStatus.js';
import { incidentTime } from '../sosLocation.js';
import './SeniorFeatures.css';

export default function SosLocation({ incident }) {
  const snapshot = incident?.details?.sos_location;
  const point = snapshot?.point;
  const reliable = isValidGpsPoint(point);
  const key = reliable ? `${point.lat},${point.lng}` : '';
  const [address, setAddress] = useState(null);
  useEffect(() => {
    if (!key || snapshot.address) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    // Optional enrichment only after the saved incident is displayed. Never in the SOS submission path.
    fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${point.lat}&lon=${point.lng}`, { signal: controller.signal, referrerPolicy: 'no-referrer' })
      .then(response => response.ok ? response.json() : null).then(data => { if (!controller.signal.aborted && data?.display_name) setAddress({ key, value: data.display_name }); }).catch(() => {})
      .finally(() => clearTimeout(timeout));
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [key, point?.lat, point?.lng, snapshot?.address]);
  if (incident?.alert_type !== 'SOS') return null;
  return <section className="sos-location" aria-label="SOS location"><h3>SOS location</h3>
    <p>Incident time: <time>{incidentTime(snapshot?.incident_at || incident.details?.first_seen_at || incident.created_at)}</time></p>
    {reliable ? <><p>GPS recorded: <time>{incidentTime(snapshot.recorded_at)}</time></p>
      {(snapshot.address || address?.key === key) && <p>{snapshot.address || address.value}</p>}
      <p className="sos-location__coordinates">{point.lat.toFixed(6)}, {point.lng.toFixed(6)}</p>
      <a href={`https://www.google.com/maps/search/?api=1&query=${point.lat},${point.lng}`} target="_blank" rel="noopener noreferrer">📍 View SOS location</a>
      <p className="senior-feature-hint">Saved at incident opening. {snapshot.source === 'family_app' ? 'The watch’s latest valid GPS fix was within 45 seconds of submission.' : 'This location stays fixed after the watch moves.'}</p>
    </> : <p role="status">Location unavailable at the time of SOS.</p>}
  </section>;
}
