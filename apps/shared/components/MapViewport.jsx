import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MapContainer, ZoomControl } from 'react-leaflet';
import { Focus, Layers, Maximize2, Minimize2, Satellite } from 'lucide-react';
import { SafeWatchTiles } from './SafeWatchMap.jsx';
import './MapViewport.css';

const defaultFitOptions = { padding: [32, 32], maxZoom: 16, animate: false };

export default function MapViewport({
  label, className = '', bounds, fitOptions = defaultFitOptions, center, zoom, scrollWheelZoom = true,
  legend, footer, variant: selectedVariant, onVariantChange, children,
}) {
  const [localVariant, setLocalVariant] = useState('standard');
  const variant = selectedVariant ?? localVariant;
  const setVariant = onVariantChange ?? setLocalVariant;
  const [expanded, setExpanded] = useState(false);
  const [host, setHost] = useState(null);
  const inline = useRef(null);
  const dialog = useRef(null);
  const expandButton = useRef(null);
  const map = useRef(null);

  // Moving the portal host keeps the same Leaflet map, camera and overlays in both views.
  const mountInline = useCallback(element => {
    inline.current = element;
    const viewport = document.createElement('div');
    viewport.className = 'watch-map__viewport';
    element.append(viewport);
    setHost(viewport);
    return () => viewport.remove();
  }, []);

  function expandMap() {
    dialog.current.append(host);
    dialog.current.showModal();
    setExpanded(true);
    expandButton.current.focus();
  }

  function restoreInlineMap() {
    inline.current.append(host);
    setExpanded(false);
    expandButton.current.focus();
  }

  function fitMap() {
    if (!map.current) return;
    map.current.stop().fitBounds(bounds, fitOptions);
  }

  return <div className={`watch-map ${className}`} data-map-style={variant}>
    <div className="watch-map__inline" ref={mountInline} />
    <dialog className="watch-map__dialog" ref={dialog} aria-label={label} onClose={restoreInlineMap} />
    {host && createPortal(<>
      <div className="watch-map__toolbar">
        <div className="watch-map__layers" role="group" aria-label="Map style">
          <button type="button" aria-pressed={variant === 'standard'} onClick={() => setVariant('standard')}><Layers aria-hidden="true" />Default</button>
          <button type="button" aria-pressed={variant === 'satellite'} onClick={() => setVariant('satellite')}><Satellite aria-hidden="true" />Satellite</button>
        </div>
        <div className="watch-map__actions">
          <button type="button" onClick={fitMap}><Focus aria-hidden="true" />Fit map</button>
          <button type="button" ref={expandButton} aria-expanded={expanded} onClick={expanded ? () => dialog.current.close() : expandMap}>
            {expanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
            {expanded ? 'Close expanded map' : 'Expand map'}
          </button>
        </div>
      </div>
      <div className="watch-map__canvas" role="region" aria-label={label}>
        <MapContainer ref={map} bounds={bounds} boundsOptions={fitOptions} center={center} zoom={zoom} zoomControl={false} scrollWheelZoom={scrollWheelZoom}>
          <SafeWatchTiles variant={variant} />
          <ZoomControl position="topright" />
          {children}
        </MapContainer>
      </div>
      {legend && <div className="watch-map__legend">{legend}</div>}
      {footer}
    </>, host)}
  </div>;
}
