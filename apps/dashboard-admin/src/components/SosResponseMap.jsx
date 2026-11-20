import { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Polygon, Popup, useMap } from 'react-leaflet';
import { Check, Clock, History, Info, ListX, MapPin, ShieldCheck } from 'lucide-react';
import MapViewport from '../../../shared/components/MapViewport.jsx';
import SeniorMapMarker from '../../../shared/components/SeniorMapMarker.jsx';
import SeniorPhoto from '../../../shared/components/SeniorPhoto.jsx';
import { familyZoneBounds, familyZoneContains } from '../../../shared/familySafeZone.js';
import TrustedHubLayers from '../../../shared/components/TrustedHubLayers.jsx';
import { safeLocationAt, safeLocationsForWatch } from '../../../shared/trustedHubs.js';
import { gpsObservation, loadLastGpsObservation, retainGpsObservation } from '../../../shared/gpsLocation.js';
import { incidentTime } from '../../../shared/sosLocation.js';
import { barangaySosStage, sosResponseState, sosTransferLabel } from '../../../shared/sosResponse.js';
import { SAN_ISIDRO_EAST_BOUNDARY } from '../../../shared/safeZone.js';
import { withRequestTimeout } from '../../../shared/requestTimeout.js';
import { isAcknowledgedSos, isPendingSos, responseMapIncidents, responseMapPositions, responseMapZone, sosResponseTabs } from '../sosResponseMap.js';
import './SosResponseMap.css';

const coordinates = point => `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
const fitOptions = { padding: [32, 32], maxZoom: 17, animate: false };
const nameOf = (incident, seniors) => seniors.find(senior => senior.id === incident.device_id)?.name || incident.devices?.patient_name || incident.seniorName || 'Senior';

function loadClearedHistory(key) {
  try {
    const ids = JSON.parse(sessionStorage.getItem(key));
    return new Set(Array.isArray(ids) ? ids.filter(id => typeof id === 'string' && /^[1-9]\d{0,18}$/.test(id)) : []);
  } catch {
    return new Set();
  }
}

function FitResponseMap({ bounds, fitKey }) {
  const map = useMap();
  const fitted = useRef(null);
  const boundsKey = JSON.stringify(bounds);
  useEffect(() => {
    const points = JSON.parse(boundsKey);
    if (fitted.current !== fitKey || points.some(point => !map.getBounds().contains(point))) {
      map.fitBounds(points, fitOptions);
      fitted.current = fitKey;
    }
  }, [map, fitKey, boundsKey]);
  useEffect(() => {
    let width = window.innerWidth;
    let height = window.innerHeight;
    function fitAfterViewportResize() {
      if (width === window.innerWidth && height === window.innerHeight) return;
      width = window.innerWidth;
      height = window.innerHeight;
      map.fitBounds(JSON.parse(boundsKey), fitOptions);
    }
    map.on('resize', fitAfterViewportResize);
    return () => { map.off('resize', fitAfterViewportResize); };
  }, [map, boundsKey]);
  return null;
}

function IncidentMap({ client, incident, senior, now, variant, onVariantChange, trustedHubs }) {
  const [gps, setGps] = useState({ observation: null, error: '', loading: true });
  const [revision, setRevision] = useState(0);
  const refreshAt = senior?.positionAt;
  useEffect(() => {
    let active = true;
    withRequestTimeout(loadLastGpsObservation(client, incident.device_id), 10000, 'Location loading took too long.')
      .then(observation => { if (active) setGps(previous => ({ observation: retainGpsObservation(previous.observation, observation), loading: false, error: '' })); })
      .catch(() => { if (active) setGps(previous => ({ ...previous, loading: false, error: 'The latest watch location could not be refreshed.' })); });
    return () => { active = false; };
  }, [client, incident.device_id, refreshAt, revision]);
  const packet = senior?.hasGpsLock ? gpsObservation({ location: { type: 'Point', coordinates: [senior.lng, senior.lat] }, received_at: senior.positionAt }) : null;
  const { sos, latest, live } = responseMapPositions(incident, retainGpsObservation(gps.observation, packet), now);
  const geofence = responseMapZone(senior);
  const name = senior?.name || incident.devices?.patient_name || incident.seniorName || 'Senior';
  const locations = safeLocationsForWatch(trustedHubs ?? [], incident.device_id);
  const hub = latest && !geofence.unavailable ? safeLocationAt(latest.point, locations) : null;
  const focus = hub || safeLocationAt(sos?.point, locations);
  const nearDistrict = [sos, latest].some(item => item && familyZoneContains(item.point, null));
  const boundary = focus || nearDistrict ? familyZoneBounds(focus) : [];
  const points = [sos, latest].filter(Boolean).map(item => [item.point.lat, item.point.lng]);
  const bounds = [...boundary, ...points];
  const visibleBounds = bounds.length ? bounds : SAN_ISIDRO_EAST_BOUNDARY;
  const outside = latest && !geofence.unavailable && !hub && !familyZoneContains(latest.point, null);
  const latestTitle = live ? 'Current watch location' : 'Last reported location';
  const samePoint = sos && latest && Math.abs(sos.point.lat - latest.point.lat) < .000001 && Math.abs(sos.point.lng - latest.point.lng) < .000001;
  return <>
    <div className="sos-response-map__heading"><h2>SOS response map</h2><p>{name} · {geofence.name}</p></div>
    <MapViewport label="SOS location map" className="sos-response-map__canvas" bounds={visibleBounds} fitOptions={fitOptions} scrollWheelZoom={false}
      variant={variant} onVariantChange={onVariantChange}
      legend={<div className="sos-response-map__legend"><span><i className="is-sos"/>Saved SOS pin</span><span><i className={live ? 'is-live' : 'is-last'}/>{live ? 'Current watch location' : 'Last reported location'}</span><span><i className="is-zone"/>Assigned geofence</span></div>}>
        <FitResponseMap bounds={visibleBounds} fitKey={`${incident.id}:${geofence.name}`}/>
        {!geofence.unavailable && (geofence.zone ? <Circle center={[geofence.zone.lat, geofence.zone.lng]} radius={geofence.zone.radius} pathOptions={{ color: '#079b70', fillColor: '#34c997', fillOpacity: .17, weight: 3 }}><Popup>{geofence.name} · {geofence.zone.radius} m assigned geofence</Popup></Circle> : <Polygon positions={SAN_ISIDRO_EAST_BOUNDARY} pathOptions={{ color: '#079b70', fillColor: '#34c997', fillOpacity: .14, weight: 3 }}><Popup>San Isidro East · Default barangay boundary</Popup></Polygon>)}
        <TrustedHubLayers hubs={locations} seniorName={name}/>
        {sos && <SeniorMapMarker deviceId={incident.device_id} position={[sos.point.lat, sos.point.lng]} kind={samePoint ? live ? 'sos-live' : 'sos-last' : 'sos'} title={`${samePoint ? 'Saved SOS and latest watch location' : 'Saved SOS location'} for ${name}`}><Popup><strong>Saved SOS location · {name}</strong><p>{coordinates(sos.point)}</p><p>Recorded {incidentTime(sos.observedAt)}</p>{samePoint && <p>{latestTitle} recorded {incidentTime(latest.observedAt)} at this same point.</p>}<small>This pin stays at the incident location.</small></Popup></SeniorMapMarker>}
        {latest && !samePoint && <SeniorMapMarker deviceId={incident.device_id} position={[latest.point.lat, latest.point.lng]} kind={live ? 'live' : 'last'} title={`${latestTitle} for ${name}`}><Popup><strong>{latestTitle} · {name}</strong><p>{coordinates(latest.point)}</p><p>Recorded {incidentTime(latest.observedAt)}</p></Popup></SeniorMapMarker>}
    </MapViewport>
    <div className="sos-response-map__facts">
      <div><span className="sos-response-map__fact-label"><MapPin aria-hidden="true"/>{latestTitle}</span><strong>{latest ? coordinates(latest.point) : gps.loading ? 'Loading watch location…' : 'No valid watch location available.'}</strong>{latest && <small>Recorded {incidentTime(latest.observedAt)}</small>}{latest && <em className={outside ? 'is-outside' : 'is-inside'}>{geofence.unavailable ? 'Geofence status unavailable' : hub ? `At safe location · ${hub.name}` : outside ? 'Outside monitored areas' : 'Inside San Isidro East'}{!live && ' · Last reported fix'}</em>}</div>
      <div><span className="sos-response-map__fact-label"><Clock aria-hidden="true"/>Saved SOS location</span><strong>{sos ? coordinates(sos.point) : 'Location unavailable at the time of SOS.'}</strong>{sos && <small>Recorded {incidentTime(sos.observedAt)}</small>}<small>Incident {incidentTime(incident.details?.sos_location?.incident_at || incident.details?.first_seen_at || incident.created_at)}</small></div>
    </div>
    {(gps.error || geofence.unavailable) && <div role="status" className="sos-response-map__notice"><Info aria-hidden="true"/><span>{gps.error || 'The assigned geofence is unavailable.'} Available saved locations are still shown.</span>{gps.error && <button type="button" onClick={() => setRevision(value => value + 1)}>Retry location</button>}</div>}
    <p className="sos-response-map__footnote"><Info aria-hidden="true"/>The SOS pin stays fixed. Last reported locations show when the GPS fix was recorded.</p>
  </>;
}

export default function SosResponseMap({ client, userId, seniors, active, responses, selected, onSelect, onDetails, onConfirm, onArrive, busy, now, trustedHubs }) {
  const [tab, setTab] = useState('active');
  const [variant, setVariant] = useState('standard');
  const historyKey = 'safewatch.barangay.sos-history.v1:' + userId;
  const [clearedHistory, setClearedHistory] = useState(() => loadClearedHistory(historyKey));
  const [historyCleared, setHistoryCleared] = useState(false);
  const records = useMemo(() => responseMapIncidents(active, responses, selected), [active, responses, selected]);
  const tabs = sosResponseTabs(records, clearedHistory, now);
  const selectedActive = tabs.active.find(row => String(row.id) === String(selected?.id));
  const selectedHistory = tabs.history.find(row => String(row.id) === String(selected?.id));
  const selectedTab = selectedActive ? 'active' : selectedHistory ? 'history' : tab;
  const rows = tabs[selectedTab];
  const incident = selectedActive || selectedHistory || rows[0];
  const senior = seniors.find(row => row.id === incident?.device_id);
  const acknowledged = isAcknowledgedSos(incident);
  const acknowledgedAt = incident?.details?.acknowledged_at || incident?.details?.sos_responses?.barangay?.at || incident?.details?.sos_responses?.family?.at;
  const stage = barangaySosStage(incident);
  const selectTab = next => { setTab(next); onSelect(tabs[next][0] || null); };
  const clearHistory = () => {
    const next = new Set([...clearedHistory, ...tabs.history.map(row => String(row.id))]);
    setClearedHistory(next);
    setHistoryCleared(true);
    setTab('history');
    onSelect(null);
    try { sessionStorage.setItem(historyKey, JSON.stringify([...next])); }
    catch { /* Clearing still works if browser storage is unavailable. */ }
  };
  return <section className="sos-response-workspace" aria-label="SOS response workspace">
    {acknowledged && <div role="status" className="sos-response-workspace__success"><span><Check aria-hidden="true"/></span><div><strong>SOS response acknowledged</strong><p>{sosResponseState(incident).message}{acknowledgedAt && ` · ${incidentTime(acknowledgedAt)}`}</p></div></div>}
    <div className="sos-response-workspace__layout">
      <aside className="sos-response-workspace__incidents"><h2>SOS incidents</h2><div className="sos-response-workspace__tabs" role="group" aria-label="SOS incident status"><button type="button" aria-pressed={selectedTab === 'active'} onClick={() => selectTab('active')}>Active</button><button type="button" aria-pressed={selectedTab === 'history'} onClick={() => selectTab('history')}>Acknowledged & history</button></div>
        {selectedTab === 'history' && <div className="sos-response-workspace__history-tools">
          <button type="button" className="sos-response-workspace__clear" onClick={clearHistory} disabled={!tabs.history.length}><ListX aria-hidden="true"/>Clear history</button>
          <p role="status">{historyCleared && 'History cleared. Saved records are in Activity & Alert History.'}</p>
        </div>}
        <div className="sos-response-workspace__list">{rows.map(row => <button type="button" key={row.id} aria-pressed={String(row.id) === String(incident?.id)} aria-label={`Select SOS ${row.id} for ${nameOf(row, seniors)}, Watch ID ${row.device_id}`} onClick={() => onSelect(row)}><SeniorPhoto deviceId={row.device_id}/><span><strong>{nameOf(row, seniors)}</strong><small>Watch ID: {row.device_id}</small><small>SOS · {incidentTime(row.created_at)}</small>{sosTransferLabel(row) && <small>{sosTransferLabel(row)}</small>}<em>{barangaySosStage(row) === 'on_the_way' ? 'On the way' : isAcknowledgedSos(row) ? 'Acknowledged' : isPendingSos(row, now) ? 'Awaiting response' : 'Incident history'}</em></span></button>)}{!rows.length && <p className="sos-response-workspace__empty">{selectedTab === 'active' ? 'No active SOS incidents.' : 'No SOS history to display.'}</p>}</div>
        {incident && <><div className="sos-response-workspace__identity"><ShieldCheck aria-hidden="true"/><div><strong>{responseMapZone(senior).name}</strong><p>{senior?.safeZone?.radius ? `${senior.safeZone.radius} m assigned geofence` : senior ? 'Default barangay boundary' : 'Senior record unavailable'}</p></div></div><button type="button" className="sos-response-workspace__details" onClick={() => onDetails(incident)}><History aria-hidden="true"/>View incident details</button>{isPendingSos(incident, now) && <button type="button" data-confirm-alert className="sos-response-workspace__confirm" disabled={busy} onClick={() => onConfirm(incident)}>{busy ? 'Saving response…' : 'Confirm response & open map'}</button>}</>}
        {stage === 'on_the_way' && <button type="button" data-confirm-alert className="sos-response-workspace__confirm" disabled={busy} onClick={() => onArrive(incident)}>{busy ? 'Saving arrival…' : 'Mark as arrived'}</button>}
      </aside>
      <div className="sos-response-map">{incident ? <IncidentMap key={incident.device_id} client={client} incident={incident} senior={senior} now={now} variant={variant} onVariantChange={setVariant} trustedHubs={trustedHubs}/> : <div className="sos-response-map__empty"><MapPin aria-hidden="true"/><h2>Select an SOS incident</h2><p>Its saved location, latest watch location and assigned geofence will appear here.</p></div>}</div>
    </div>
  </section>;
}
