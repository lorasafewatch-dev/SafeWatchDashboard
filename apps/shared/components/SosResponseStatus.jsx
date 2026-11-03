import { sosResponseState } from '../sosResponse.js';
import './SosResponseStatus.css';

const formatTime = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-PH', {
  timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
}) : '';

export function SosResponseIndicator({ incident }) {
  if (incident?.alert_type !== 'SOS') return null;
  const { responses, message, confirmed } = sosResponseState(incident);
  if (!responses.family && !responses.barangay) return null;
  return <div className={`sos-response-status${confirmed ? ' sos-response-status--confirmed' : ''}`} role="status">
    <p className="sos-response-status__message">{message}</p>
    {['family','barangay'].map(role => responses[role] && <p key={role} className="sos-response-status__receipt">
      <strong>{role === 'family' ? 'Family' : 'Barangay secretary'}: {responses[role].decision === 'confirmed' ? 'Confirmed' : 'Declined'}</strong>
      {responses[role].at && <time dateTime={responses[role].at}>{formatTime(responses[role].at)} PHT</time>}
    </p>)}
  </div>;
}

export default function SosResponseUpdates({ responses = [], error = '', onRetry }) {
  return <section className="sos-response-updates" aria-label="Shared SOS response updates">
    <h2>SOS response updates</h2><p>Family and barangay secretary decisions are visible to both sides.</p>
    {error && <p role="alert">{error} {onRetry && <button type="button" onClick={onRetry}>Retry updates</button>}</p>}
    {!responses.length && !error && <p>No SOS responses recorded yet.</p>}
    <div className="sos-response-updates__list">{responses.map(incident => <article key={incident.id}>
      <h3>{incident.devices?.patient_name || 'Linked senior'}</h3>
      <p className="sos-response-updates__incident">SOS · {formatTime(incident.created_at)} PHT · #{incident.id}</p>
      <SosResponseIndicator incident={incident}/>
    </article>)}</div>
  </section>;
}
