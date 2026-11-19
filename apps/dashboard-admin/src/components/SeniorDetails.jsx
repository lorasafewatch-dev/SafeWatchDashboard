import { useEffect, useId, useRef } from 'react';
import { Activity, Battery, Clock, Droplets, HeartPulse, History, MapPin, UserRound, X } from 'lucide-react';
import SeniorPhoto from '../../../shared/components/SeniorPhoto.jsx';
import { dialogKeyboard } from '../../../shared/dialogKeyboard.js';
import { isCurrentGpsPoint } from '../../../shared/gpsStatus.js';
import { readingStatus, readingText, watchUpdate } from '../adminPresentation.js';
import './SeniorDetails.css';

const recordedTime = timestamp => new Date(timestamp).toLocaleString('en-PH', {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Manila',
});
const metrics = [
  { field: 'pulse', label: 'Pulse rate', unit: ' bpm', Icon: HeartPulse },
  { field: 'spo2', label: 'Blood oxygen', unit: '%', Icon: Droplets },
  { field: 'battery', label: 'Watch battery', unit: '%', Icon: Battery },
];

export default function SeniorDetails({ senior, now, onClose, onMap, onHistory, onHealth }) {
  const titleId = useId();
  const closeButton = useRef(null);
  const update = watchUpdate(senior, now);
  const age = Number(senior.age);
  const hasGps = senior.hasGpsLock && isCurrentGpsPoint(senior, senior.positionAt, now);
  useEffect(() => {
    const opener = document.activeElement;
    closeButton.current?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);

  return <div className="senior-details" onKeyDown={event => dialogKeyboard(event, onClose)} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby={titleId} className="senior-details__window">
      <header className="senior-details__header"><span className="senior-details__heading-icon"><UserRound aria-hidden="true"/></span><div><p>Senior Monitoring</p><h2 id={titleId}>Senior details</h2></div><button ref={closeButton} type="button" className="senior-details__close" aria-label="Close senior details" onClick={onClose}><X aria-hidden="true"/></button></header>
      <div className="senior-details__body">
        <div className="senior-details__person"><SeniorPhoto senior={senior} className="senior-details__avatar"/><div><h3>{senior.name}</h3><p>{Number.isFinite(age) && age > 0 ? `${age} years old` : 'Age not provided'}<span aria-hidden="true"> · </span>{senior.gender || 'Gender not provided'}</p><div className="senior-details__watch"><span>Watch ID</span><code>{senior.id}</code></div></div></div>
        <div className={`senior-details__update${update.fresh ? ' is-current' : ''}`}><Clock aria-hidden="true"/><div><strong>Watch update · {update.label}</strong><span>{update.timestamp ? `${recordedTime(update.timestamp)} · Philippine time` : 'Waiting for the first watch reading.'}</span></div></div>
        <section aria-label="Latest readings"><div className="senior-details__section-title"><h3>Latest readings</h3><span>{update.fresh ? 'Current packet' : 'Last received packet'}</span></div><div className="senior-details__metrics">{metrics.map(({ field, label, unit, Icon }) => {
          const status = readingStatus(senior, field, now);
          return <div className="senior-details__metric" key={field}><Icon aria-hidden="true"/><p>{label}</p><strong>{readingText(senior, field, unit)}</strong><span className={`senior-details__reading senior-details__reading--${status.tone}`}>{status.label}</span></div>;
        })}</div></section>
        <section className={`senior-details__location${hasGps ? ' has-gps' : ''}`} aria-label="Current watch location"><MapPin aria-hidden="true"/><div><h3>{hasGps ? 'Current watch location' : 'No current GPS fix'}</h3><p>{hasGps ? `${senior.lat.toFixed(6)}, ${senior.lng.toFixed(6)}` : 'A current location will appear when the watch sends a valid GPS fix.'}</p>{hasGps && <small>Recorded {recordedTime(update.timestamp)} · Philippine time</small>}</div><button type="button" disabled={!hasGps} onClick={onMap}>View on map</button></section>
      </div>
      <footer className="senior-details__footer"><button type="button" onClick={onHistory}><History aria-hidden="true"/>Location history</button><button type="button" className="senior-details__primary" onClick={onHealth}><Activity aria-hidden="true"/>Health overview</button></footer>
    </section>
  </div>;
}
