import SeniorPhoto from './SeniorPhoto.jsx';
import SosLocation from './SosLocation.jsx';
import { incidentTime } from '../sosLocation.js';
import { SosResponseIndicator } from './SosResponseStatus.jsx';
import { alertTitle } from '../alertLifecycle.js';
import { dialogKeyboard } from '../dialogKeyboard.js';

export default function IncidentDetails({ incident, onClose }) {
  if (!incident) return null;
  return <div className="incident-details" onKeyDown={event => dialogKeyboard(event, onClose)}><section role="dialog" aria-modal="true" aria-label="Alert details">
    <button type="button" className="incident-details__close" onClick={onClose} autoFocus>Close details</button><h2>{alertTitle(incident)}</h2>
    <div className="senior-feature-person"><SeniorPhoto deviceId={incident.device_id}/><strong>{incident.devices?.patient_name || 'Senior'}</strong></div>
    <p>Watch ID: {incident.device_id}</p><p>{incidentTime(incident.created_at)}</p>
    <SosLocation incident={incident}/><SosResponseIndicator incident={incident}/>
  </section></div>;
}
