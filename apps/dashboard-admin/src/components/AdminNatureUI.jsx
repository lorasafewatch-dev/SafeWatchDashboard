import { useState } from 'react';
import { alertTitle, batteryAlertMessage } from '../../../shared/alertLifecycle.js';
import { SosResponseIndicator } from '../../../shared/components/SosResponseStatus.jsx';
import { sosResponseState } from '../../../shared/sosResponse.js';
import { Battery, Bell, ChevronRight, MapPin, Search, ShieldCheck, Users, Watch } from 'lucide-react';
import { monitoringSummary, readingStatus, readingText, watchUpdate } from '../adminPresentation.js';
import StatCard from './StatCard.jsx';
import SeniorPhoto from '../../../shared/components/SeniorPhoto.jsx';

export function AdminAvatar({ name = '', className = '', senior }) {
  if (senior?.photo_path) return <SeniorPhoto senior={senior} className={className}/>;
  const initials = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => Array.from(part)[0]).join('').toUpperCase();
  return <span className={`admin-avatar ${className}`} aria-hidden="true">{initials || <Users />}</span>;
}

export function ReadingLabel({ senior, field, now }) {
  const status = readingStatus(senior, field, now);
  return <span className={`admin-reading-label admin-reading-label--${status.tone}`}>{status.label}</span>;
}

export function AdminOverview({ seniors, alerts, now, children, onNavigate, onDetails, onConfirm, onDecline, confirming, onLocate }) {
  const [search, setSearch] = useState('');
  const summary = monitoringSummary(seniors, now);
  const inside = seniors.filter(senior => senior.hasGpsLock && senior.insideSafeZone).length;
  const filtered = seniors.filter(senior => senior.name?.toLowerCase().includes(search.trim().toLowerCase()));
  const priorityAlerts = [...alerts].sort((a, b) => Number(b.rawType === 'SOS') - Number(a.rawType === 'SOS'));
  return <div className="admin-page admin-overview">
    <div className="admin-stats">
      <StatCard icon={Users} value={seniors.length} label="Seniors monitored" subtext="View seniors" onClick={() => onNavigate('Senior Monitoring')} showSignal={false} />
      <StatCard icon={MapPin} value={inside} label="Inside safe zone" subtext="Current GPS positions" onClick={() => onNavigate('Live Location')} showSignal={false} />
      <StatCard icon={Bell} value={alerts.length} label="Active alerts" subtext={alerts.length ? 'Needs attention' : 'No active incidents'} onClick={() => onNavigate('SOS Alerts')} tone={alerts.length ? 'danger' : 'green'} showSignal={false} />
      <StatCard icon={Watch} value={summary.offline} label="Watches offline" subtext="No packet in the last 45s" onClick={() => onNavigate('Senior Monitoring')} tone="muted" showSignal={false} />
    </div>
    <div className="admin-overview__middle">
      <section className="card admin-overview__map" aria-label="Location overview">
        <div className="admin-panel-heading"><h2>Live location <span className="admin-dot" /></h2><button type="button" onClick={() => onNavigate('Live Location')} className="admin-text-action">Open live location<ChevronRight aria-hidden="true" /></button></div>
        <div className="admin-overview__map-canvas">{children}</div>
      </section>
      <section className="card admin-overview__alerts" aria-label="Active alerts overview">
        <div className="admin-panel-heading"><h2>Active alerts <span className={`admin-count${alerts.length ? ' admin-count--danger' : ''}`}>{alerts.length}</span></h2><button className="admin-text-action" onClick={() => onNavigate('SOS Alerts')}>View all</button></div>
        <div className="admin-incident-list">
          {!alerts.length && <div className="admin-empty"><ShieldCheck /><h3>All clear</h3><p>No active alerts require a response.</p></div>}
          {priorityAlerts.map(incident => <article key={incident.key || incident.id} className={`admin-incident ${incident.rawType === 'SOS' ? 'admin-incident--sos' : ''}`}>
            <div className="admin-incident__icon">{incident.rawType === 'SOS' ? <Bell /> : incident.rawType === 'LOW_BATTERY' ? <Battery /> : <MapPin />}</div>
            <div className="admin-incident__body"><div className="admin-incident__title"><h3>{alertTitle(incident)}</h3><time>{incident.time}</time></div>
              <p className="admin-incident__name">{incident.seniorName}</p><p className="admin-incident__description">{incident.rawType === 'SOS' ? 'Watch SOS button pressed' : incident.rawType === 'LOW_BATTERY' ? batteryAlertMessage(incident) : 'Senior left the designated boundary'}</p>
              <SosResponseIndicator incident={incident}/>
              <div className="admin-incident__actions">
                <button type="button" className="admin-action-button" onClick={() => onDetails(incident)}>View details</button>
                <button type="button" className="admin-action-button admin-action-button--confirm" data-confirm-alert disabled={confirming} onClick={() => onConfirm(incident)}>{confirming ? 'Saving…' : 'Confirm response'}</button>
                {incident.alert_type === 'SOS' && onDecline && <button type="button" className="admin-action-button admin-action-button--decline" data-confirm-alert disabled={confirming || sosResponseState(incident).responses.barangay?.decision === 'declined'} onClick={() => onDecline(incident)}>Decline — notify family</button>}
              </div>
            </div>
          </article>)}
        </div>
      </section>
    </div>
    <section className="card admin-overview__seniors" aria-label="Senior monitoring overview">
      <div className="admin-panel-heading"><h2>Senior monitoring</h2><div className="admin-panel-tools"><label className="admin-search"><Search /><input aria-label="Search overview seniors" placeholder="Search seniors…" value={search} onChange={event => setSearch(event.target.value)} /></label><button className="admin-text-action" onClick={() => onNavigate('Senior Monitoring')}>View all seniors<ChevronRight /></button></div></div>
      <div className="admin-table-scroll"><table><thead><tr><th>Senior</th><th>Pulse rate</th><th>Blood oxygen</th><th>Watch battery</th><th>Location</th><th>Last update</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
        {filtered.slice(0, 6).map(senior => {
          const update = watchUpdate(senior, now);
          return <tr key={senior.id}><td><div className="admin-person"><AdminAvatar name={senior.name} senior={senior} /><span>{senior.name}</span></div></td><td>{readingText(senior, 'pulse', ' bpm')}</td><td>{readingText(senior, 'spo2', '%')}</td><td><span className="admin-battery"><Battery />{readingText(senior, 'battery', '%')}</span></td><td><span className={`admin-zone admin-zone--${senior.hasGpsLock ? senior.insideSafeZone ? 'inside' : senior.insideTrustedZone ? 'trusted' : 'outside' : 'unknown'}`}>{senior.hasGpsLock ? senior.insideSafeZone ? 'Inside zone' : senior.insideTrustedZone ? 'Trusted hub' : 'Outside zone' : 'No current GPS'}</span></td><td><span className={!update.fresh ? 'admin-muted' : ''}>{update.label}</span></td><td><button className="admin-row-action" aria-label={`Locate ${senior.name}`} disabled={!senior.hasGpsLock} onClick={() => onLocate(senior)}><ChevronRight /></button></td></tr>;
        })}
        {!filtered.length && <tr><td colSpan={7}><div className="admin-table-empty">{seniors.length ? 'No seniors match this search.' : 'No seniors registered yet. Add a senior to begin monitoring.'}</div></td></tr>}
      </tbody></table></div>
    </section>
  </div>;
}
