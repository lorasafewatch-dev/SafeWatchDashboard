import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { activityAlertTitle, activityHistoryError, activityStatus, activityTitle, loadActivityHistory } from '../activityHistory.js';
import { manilaDate } from '../locationHistory.js';
import { withRequestTimeout } from '../requestTimeout.js';
import './ActivityHistory.css';

const timeLabel = value => new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila',
  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const EMPTY_PAGE = { records: [], cursor: null, hasMore: false };

export function ActivityHistoryList({ page, loading, error, onRefresh, onRetry, onEarlier }) {
  return <div aria-busy={loading}>
    <div className="watch-activity__summary"><span>{page.records.length} records loaded{page.hasMore ? ' · more available' : ''}</span><button type="button" disabled={loading} onClick={onRefresh}>Refresh history</button></div>
    {error && <p role="alert" className="watch-activity__error">{error} <button type="button" disabled={loading} onClick={onRetry}>Retry</button></p>}
    {loading && <p role="status">Loading activity…</p>}
    {!loading && !error && !page.records.length && <p role="status">No records for this date and these filters.</p>}
    <ol className="watch-activity__list" aria-label="Activity records, newest first">{page.records.map(record => <li key={record.event_id}>
      <article>
        <div className="watch-activity__record-top"><span className={`watch-activity__category watch-activity__category--${record.category}`}>{record.category === 'alerts' ? activityAlertTitle(record.alert_type) : record.category === 'movements' ? 'Movement' : 'System'}</span><time dateTime={record.occurred_at}>{timeLabel(record.occurred_at)} PHT</time></div>
        <h3>{activityTitle(record)}</h3><p>{record.patient_name || 'Administration'}{record.details?.alert_id ? ` · Alert #${record.details.alert_id}` : ''}</p>
        {activityStatus(record) && <p className="watch-activity__status">{activityStatus(record)}</p>}
        {['family','barangay'].map(role => record.details?.[`${role}_decision`] && <p key={role}>{role === 'family' ? 'Family' : 'Barangay secretary'}: {record.details[`${role}_decision`] === 'confirmed' ? 'Confirmed' : 'Declined'}</p>)}
        {record.category === 'movements' && Number.isFinite(record.lat) && Number.isFinite(record.lng) && <p>Latitude {record.lat.toFixed(5)}, longitude {record.lng.toFixed(5)}</p>}
        {record.event_kind === 'alert_snapshot' && <p className="watch-activity__note">Saved state of an alert that predates the activity log. Earlier changes are unavailable.</p>}
      </article>
    </li>)}</ol>
    {page.hasMore && <button className="watch-activity__more" type="button" disabled={loading} onClick={onEarlier}>Load earlier records</button>}
  </div>;
}

function ActivityRecords({ client, day, deviceId, category, alertType }) {
  const [page, setPage] = useState(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const busy = useRef(false);
  const controller = useRef(null);
  const retryCursor = useRef(null);
  const request = useCallback(async (cursor = null) => {
    if (busy.current) return;
    busy.current = true;
    const id = ++requestId.current;
    controller.current = new AbortController();
    retryCursor.current = cursor;
    setLoading(true); setError('');
    try {
      const result = await withRequestTimeout(loadActivityHistory(client, { day, deviceId, category, alertType }, cursor, controller.current.signal), 10000);
      if (id !== requestId.current) return;
      setPage(previous => ({ ...result, records: cursor
        ? [...new Map([...previous.records, ...result.records].map(record => [record.event_id, record])).values()] : result.records }));
    } catch (failure) {
      if (id !== requestId.current) return;
      setError(activityHistoryError(failure));
      if (['42501','PGRST301'].includes(failure?.code)) setPage(EMPTY_PAGE);
    } finally {
      if (id === requestId.current) { controller.current?.abort(); busy.current = false; setLoading(false); }
    }
  }, [client, day, deviceId, category, alertType]);
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => { if (!cancelled) request(); });
    return () => { cancelled = true; requestId.current += 1; controller.current?.abort(); busy.current = false; };
  }, [request]);
  return <ActivityHistoryList page={page} loading={loading} error={error} onRefresh={() => request()} onRetry={() => request(retryCursor.current)} onEarlier={() => request(page.cursor)}/>;
}

export default function ActivityHistory({ client, seniors = [], initialCategory = 'all' }) {
  const [day, setDay] = useState(() => manilaDate());
  const [deviceId, setDeviceId] = useState('');
  const [category, setCategory] = useState(initialCategory);
  const [alertType, setAlertType] = useState('');
  const id = useId();
  // Removing a linked watch immediately unmounts its cached records.
  const availableDevice = seniors.some(senior => senior.id === deviceId) ? deviceId : '';
  const scope = seniors.map(senior => senior.id).sort().join(',');
  return <section className="watch-activity" aria-labelledby={`${id}-title`}>
    <header><h2 id={`${id}-title`}>Activity log &amp; alert history</h2><p>Review notifications, recorded GPS movements, and system changes. Reading history does not confirm or resolve an alert.</p></header>
    <div className="watch-activity__filters">
      <label>Date (Philippines)<input type="date" value={day} max={manilaDate()} onChange={event => { if (event.target.value) setDay(event.target.value); }}/></label>
      <label>Senior<select value={availableDevice} onChange={event => setDeviceId(event.target.value)}><option value="">All accessible seniors</option>{seniors.map(senior => <option key={senior.id} value={senior.id}>{senior.patient_name || senior.name}</option>)}</select></label>
      <label>Record type<select value={category} onChange={event => setCategory(event.target.value)}><option value="all">All activity</option><option value="alerts">Alert history</option><option value="movements">Movements</option><option value="system">System events</option></select></label>
      {category === 'alerts' && <label>Alert type<select value={alertType} onChange={event => setAlertType(event.target.value)}><option value="">All alerts</option><option value="SOS">SOS</option><option value="GEOFENCE">Geofence</option><option value="LOW_BATTERY">Low battery</option></select></label>}
    </div>
    <ActivityRecords key={`${scope}:${day}:${availableDevice}:${category}:${alertType}`} client={client} day={day} deviceId={availableDevice} category={category} alertType={alertType}/>
    <p className="watch-activity__note">GPS records are observations, not proof of the path between points. Use Location history to review the route. Administrative audit records are visible only to authorized administrators.</p>
  </section>;
}
