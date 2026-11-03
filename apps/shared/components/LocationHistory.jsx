import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, MapContainer, Polyline, Popup, useMap } from 'react-leaflet';
import { SafeWatchTiles } from './SafeWatchMap.jsx';
import { historySegments, loadLocationHistory, locationHistoryError, manilaDate } from '../locationHistory.js';
import { withRequestTimeout } from '../requestTimeout.js';
import 'leaflet/dist/leaflet.css';
import './LocationHistory.css';

const timeLabel = value => new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila',
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

function HistoryCamera({ points, selected }) {
  const map = useMap();
  useEffect(() => {
    if (selected) map.setView([selected.lat, selected.lng], 17, { animate: false });
    else if (points.length) map.fitBounds(points.map(point => [point.lat, point.lng]), { padding: [28, 28], maxZoom: 17, animate: false });
  }, [map, points, selected]);
  return null;
}

function HistoryDay({ client, deviceId, day, name }) {
  const [result, setResult] = useState({ points: [], cursor: null, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const sequence = useRef(0);
  const busy = useRef(false);
  const retryCursor = useRef(null);
  const requestPage = async (cursor = null) => {
    if (busy.current) return;
    busy.current = true;
    const request = ++sequence.current;
    retryCursor.current = cursor;
    setLoading(true);
    setError('');
    try {
      const page = await withRequestTimeout(loadLocationHistory(client, deviceId, day, cursor), 10000);
      if (request !== sequence.current) return;
      setResult(previous => ({ ...page, points: cursor ? [...previous.points, ...page.points] : page.points }));
      if (!cursor) setSelectedId(null);
    } catch (failure) {
      if (request !== sequence.current) return;
      setError(locationHistoryError(failure));
      if (['42501', 'PGRST301'].includes(failure?.code)) setResult({ points: [], cursor: null, hasMore: false });
    } finally {
      if (request === sequence.current) { busy.current = false; setLoading(false); }
    }
  };
  useEffect(() => {
    let cancelled = false;
    // Defer to keep setup/cleanup safe under React StrictMode.
    Promise.resolve().then(() => { if (!cancelled) requestPage(); });
    return () => { cancelled = true; sequence.current += 1; busy.current = false; };
    // Each day/watch/client is mounted with a fresh request and state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, deviceId, day]);
  const segments = useMemo(() => historySegments(result.points), [result.points]);
  const selected = result.points.find(point => String(point.telemetry_id) === selectedId);
  const earliest = result.points.at(-1);
  const latest = result.points[0];
  return <div aria-busy={loading}>
    <div className="watch-history__summary"><span>{result.points.length} GPS points loaded{result.hasMore ? ' · more available' : ''}</span><button type="button" disabled={loading} onClick={() => requestPage()}>Refresh history</button></div>
    {error && <p role="alert" className="watch-history__error">{error} <button type="button" disabled={loading} onClick={() => requestPage(retryCursor.current)}>Retry</button></p>}
    {loading && <p role="status">Loading recorded locations…</p>}
    {!loading && !error && !result.points.length && <p role="status">No GPS locations recorded for this date.</p>}
    {result.points.length > 0 && <>
      <p className="watch-history__range">{timeLabel(earliest.observed_at)} – {timeLabel(latest.observed_at)} (Philippine time)</p>
      <div className="watch-history__map" aria-label={`Recorded locations for ${name}`}>
        <MapContainer center={[latest.lat, latest.lng]} zoom={15} style={{ height: '100%', width: '100%' }}>
          <SafeWatchTiles/>
          <HistoryCamera points={result.points} selected={selected}/>
          {segments.filter(segment => segment.length > 1).map(segment => <Polyline key={segment[0].telemetry_id} positions={segment.map(point => [point.lat, point.lng])} pathOptions={{ color: '#00866b', weight: 4 }}/>) }
          {[earliest, ...(latest !== earliest ? [latest] : []), ...(selected && selected !== earliest && selected !== latest ? [selected] : [])].map(point => <CircleMarker key={point.telemetry_id} center={[point.lat, point.lng]} radius={7} pathOptions={{ color: point === selected ? '#b65c16' : '#075b53', fillOpacity: 1 }}><Popup>{timeLabel(point.observed_at)}<br/>{point === earliest ? 'First loaded point' : point === latest ? 'Latest loaded point' : 'Selected location'}</Popup></CircleMarker>)}
        </MapContainer>
      </div>
      <p className="watch-history__hint">Lines connect recorded GPS points; gaps over five minutes are left open. Select a time to inspect its location. These are historical positions.</p>
      <ol className="watch-history__points" aria-label="Recorded GPS points, newest first">
        {result.points.map(point => <li key={point.telemetry_id}><button type="button" aria-pressed={String(point.telemetry_id) === selectedId} onClick={() => setSelectedId(String(point.telemetry_id))}><time dateTime={point.observed_at}>{timeLabel(point.observed_at)}</time><span>{point.lat.toFixed(5)}, {point.lng.toFixed(5)}</span></button></li>)}
      </ol>
      {result.hasMore && <button className="watch-history__more" type="button" disabled={loading} onClick={() => requestPage(result.cursor)}>Load earlier locations</button>}
    </>}
  </div>;
}

export default function LocationHistory({ client, deviceId, name = 'this senior' }) {
  const [day, setDay] = useState(() => manilaDate());
  if (!deviceId || !client) return null;
  return <section className="watch-history" aria-label="Location history">
    <div className="watch-history__heading"><div><h2>Location history</h2><p>Review {name}'s recorded movement.</p></div><label>Date (Philippines)<input aria-label="Location history date" type="date" value={day} max={manilaDate()} onChange={event => { if (event.target.value) setDay(event.target.value); }}/></label></div>
    <HistoryDay key={`${deviceId}:${day}`} client={client} deviceId={deviceId} day={day} name={name}/>
  </section>;
}
