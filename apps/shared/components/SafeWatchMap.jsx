import { useEffect, useMemo, useRef, useState } from 'react';
import { TileLayer, ZoomControl, useMap } from 'react-leaflet';
import L from 'leaflet';
import { EMPTY_MAP_TILE, MAP_LAYERS } from '../mapTiles.js';

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
      frame = requestAnimationFrame(() => map.invalidateSize({ pan: false, debounceMoveend: true }));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(map.getContainer());
    resize();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [map]);
  return null;
}

export function SafeWatchTiles({ variant = 'standard' }) {
  const provider = MAP_LAYERS[variant] || MAP_LAYERS.standard;
  const layer = useRef(null);
  const failedInBatch = useRef(false);
  const [unavailable, setUnavailable] = useState(false);
  const events = useMemo(() => ({
    loading: () => { failedInBatch.current = false; },
    tileerror: () => { failedInBatch.current = true; setUnavailable(true); },
    load: () => setUnavailable(failedInBatch.current),
  }), []);
  return <>
    {/* OSM receives the public origin, never an account path or query. */}
    <TileLayer key={variant} ref={layer} url={provider.url} attribution={provider.attribution}
      referrerPolicy="origin" maxNativeZoom={provider.maxNativeZoom} maxZoom={20}
      noWrap updateWhenIdle keepBuffer={1} errorTileUrl={EMPTY_MAP_TILE} eventHandlers={events} />
    <MapSizeSync />
    {unavailable && <MapNotice onRetry={() => {
      failedInBatch.current = false;
      setUnavailable(false);
      layer.current?.redraw();
    }} />}
  </>;
}

function MapNotice({ onRetry }) {
  const container = useRef(null);
  useEffect(() => { L.DomEvent.disableClickPropagation(container.current); L.DomEvent.disableScrollPropagation(container.current); }, []);
  return <div ref={container} role="status" className="absolute bottom-20 left-4 right-4 z-[1000] max-w-sm rounded-xl border border-amber-200 bg-white/95 px-4 py-3 shadow text-xs text-amber-900">
    <p>Map background unavailable. Check your connection and try again. Location markers may still be shown.</p>
    <button type="button" onClick={onRetry} className="mt-2 font-bold underline">Retry map</button>
  </div>;
}

export function MapNavigation({ bounds }) {
  const map = useMap();
  const container = useRef(null);
  useEffect(() => { L.DomEvent.disableClickPropagation(container.current); L.DomEvent.disableScrollPropagation(container.current); }, []);
  return <>
    <ZoomControl position="topright" />
    <div ref={container} className="absolute top-[90px] right-[10px] z-[1000]">
      <button type="button" onClick={() => { map.stop(); map.fitBounds(bounds, { padding: [32, 32], maxZoom: 16, animate: false }); }}
        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-emerald-800 shadow">Show boundary</button>
    </div>
  </>;
}
