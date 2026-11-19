import { useEffect, useState } from 'react';
import { manilaDate } from '../locationHistory.js';
import { withRequestTimeout } from '../requestTimeout.js';
import SeniorPicker from './SeniorPicker.jsx';
import SeniorPhoto from './SeniorPhoto.jsx';
import './SeniorFeatures.css';

function DailyReadings({ client, deviceId, day, revision }) {
  const [result, setResult] = useState({ loading: true });
  useEffect(() => {
    let active = true;
    withRequestTimeout(client.rpc('get_watch_daily_health', { p_device_id: deviceId, p_day: day }), 10000)
      .then(({ data, error }) => { if (error) throw error; if (!data?.[0]) throw new Error('Missing daily summary'); if (active) setResult({ row: data[0] }); })
      .catch(() => { if (active) setResult({ error: 'Daily averages could not be loaded. Refresh to retry.' }); });
    return () => { active = false; };
  }, [client, deviceId, day, revision]);
  const row = result.row;
  return <div aria-busy={!!result.loading}>
    {result.loading && <p role="status">Loading daily averages…</p>}
    {result.error && <p role="alert">{result.error}</p>}
    {row && <><div className="daily-averages__metrics">{[['pulse_average', 'pulse_count', 'Average pulse rate (bpm)'], ['oxygen_average', 'oxygen_count', 'Average blood oxygen (%)']].map(([average, count, title]) => <div key={average}><h3>{title}</h3><strong>{Number(row[count]) > 0 ? Number(row[average]).toFixed(1) : '—'}</strong><p>{row[count]} valid readings</p>{!Number(row[count]) && <p>No readings for this date</p>}</div>)}</div></>}
  </div>;
}

export default function DailyAverages({ client, deviceId, seniors, onSelect, name }) {
  const [day, setDay] = useState(() => manilaDate());
  const [revision, setRevision] = useState(0);
  return <section className="daily-averages" aria-label="Daily averages">
    <div className="daily-averages__heading"><div><h2>Daily averages</h2><p>{name ? `${name} · ` : ''}Recorded samples by Philippine calendar date.</p></div><button type="button" onClick={() => setRevision(value => value + 1)}>Refresh averages</button></div>
    <div className="daily-averages__filters">{seniors && <><SeniorPhoto deviceId={deviceId}/><SeniorPicker seniors={seniors} value={deviceId} onChange={onSelect} label="Senior for daily averages"/></>}<label>Date (Philippines)<input aria-label="Daily averages date" type="date" value={day} max={manilaDate()} onChange={event => { if (event.target.value) setDay(event.target.value); }}/></label></div>
    {deviceId ? <DailyReadings key={`${deviceId}:${day}:${revision}`} client={client} deviceId={deviceId} day={day} revision={revision}/> : <p>Select a senior to view daily averages.</p>}
    <p className="senior-feature-hint">Missing values, pulse outside 1–300 bpm, and blood oxygen outside 1–100% are excluded independently. Averages are for monitoring.</p>
  </section>;
}
