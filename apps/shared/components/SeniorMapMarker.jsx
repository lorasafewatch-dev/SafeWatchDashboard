import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Marker } from 'react-leaflet';
import L from 'leaflet';
import SeniorPhoto from './SeniorPhoto.jsx';
import './SeniorMapMarker.css';

export default function SeniorMapMarker({ deviceId, position, kind, title, children }) {
  const marker = useRef(null);
  const { element, icon } = useMemo(() => {
    const element = document.createElement('div');
    return { element, icon: L.divIcon({ html: element, className: 'senior-photo-map-marker', iconSize: [56, 68], iconAnchor: [28, 66], popupAnchor: [0, -58] }) };
  }, []);
  useEffect(() => { marker.current?.getElement()?.setAttribute('aria-label', title); }, [title]);
  return <>
    <Marker ref={marker} position={position} icon={icon} title={title} alt={title} keyboard zIndexOffset={kind === 'sos' ? 100 : 200}>{children}</Marker>
    {createPortal(<div className={`senior-photo-map-pin senior-photo-map-pin--${kind}`}>
      <span className="senior-photo-map-pin__tip"/>
      <span className="senior-photo-map-pin__photo"><SeniorPhoto deviceId={deviceId}/></span>
      <span className="senior-photo-map-pin__badge">{kind === 'sos' ? 'SOS' : kind === 'live' ? 'NOW' : kind === 'sos-live' ? 'SOS · NOW' : kind === 'sos-last' ? 'SOS · LAST' : 'LAST'}</span>
    </div>, element)}
  </>;
}
