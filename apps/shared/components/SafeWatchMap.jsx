import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import { mapTileSources } from '../mapTiles.js';

function MapSizeSync() {
  const map = useMap();
  useEffect(() => {
    // Keep provider credits readable inside the rounded map corners.
    const credits = map.attributionControl?.getContainer();
    if (credits) {
      credits.style.margin = '0 20px 8px';
      credits.style.maxWidth = 'calc(100% - 40px)';
      credits.parentElement.style.maxWidth = '100%';
    }
    let frame;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => map.invalidateSize({ debounceMoveend: true }));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(map.getContainer());
    resize();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [map]);
  return null;
}

export function SafeWatchTiles({ variant = 'standard' }) {
  return <>
    <MapBackground key={variant} variant={variant} />
    <MapSizeSync />
  </>;
}

function MapBackground({ variant }) {
  const sources = mapTileSources(variant);
  const [attempt, setAttempt] = useState({ source: 0, revision: 0 });
  const [unavailable, setUnavailable] = useState(false);
  const lastSource = sources.length - 1;
  const onFailure = useCallback((hasTiles = false) => {
    if (attempt.source < lastSource) {
      setAttempt(current => current === attempt ? { ...current, source: current.source + 1 } : current);
    } else if (!hasTiles) setUnavailable(true);
  }, [attempt, lastSource]);
  const onAvailable = useCallback(() => setUnavailable(false), []);
  const retry = useCallback(() => {
    setUnavailable(false);
    setAttempt(current => ({ source: 0, revision: current.revision + 1 }));
  }, []);
  useEffect(() => {
    if (!unavailable) return;
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [retry, unavailable]);
  return <>
    <RasterTiles key={`${attempt.revision}:${attempt.source}`} provider={sources[attempt.source]} onFailure={onFailure} onAvailable={onAvailable}/>
    {(unavailable || variant === 'satellite' && attempt.source > 0) && <MapNotice unavailable={unavailable} onRetry={retry}/>}
  </>;
}

function RasterTiles({ provider, onFailure, onAvailable }) {
  const loaded = useRef(false);
  const failures = useRef(0);
  const timer = useRef(null);
  const startDeadline = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (!loaded.current) onFailure(); }, 7000);
  }, [onFailure]);
  useEffect(() => { startDeadline(); return () => clearTimeout(timer.current); }, [startDeadline]);
  const events = useMemo(() => ({
    loading: () => { loaded.current = false; failures.current = 0; startDeadline(); },
    tileload: () => { loaded.current = true; onAvailable(); },
    tileerror: () => { failures.current += 1; },
    load: () => { clearTimeout(timer.current); if (failures.current) onFailure(loaded.current); },
  }), [onAvailable, onFailure, startDeadline]);
  // Send the public origin with tile requests without exposing page paths.
  return <TileLayer url={provider.url} attribution={provider.attribution} referrerPolicy="origin"
    maxNativeZoom={provider.maxNativeZoom} maxZoom={20} noWrap updateWhenIdle keepBuffer={1} eventHandlers={events}/>;
}

function MapNotice({ unavailable, onRetry }) {
  const container = useRef(null);
  useEffect(() => { L.DomEvent.disableClickPropagation(container.current); L.DomEvent.disableScrollPropagation(container.current); }, []);
  return <div ref={container} role="status" className="absolute bottom-9 left-2 z-[1000] flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-x-2 rounded-md bg-white/95 px-2 py-1 text-xs text-slate-700 shadow">
    <span>{unavailable ? 'Map tiles could not load.' : 'Showing the street map.'}</span>
    <button type="button" onClick={onRetry} className="font-bold underline">{unavailable ? 'Retry map' : 'Retry satellite'}</button>
  </div>;
}
