import { Circle, Popup } from 'react-leaflet';

const hubStyle = { color: '#2b77a1', fillOpacity: .15, weight: 2, dashArray: '5 8' };

export default function TrustedHubLayers({ hubs = [] }) {
  return hubs.map(hub => <Circle key={hub.id} center={[hub.lat, hub.lng]} radius={hub.radius} className="watch-trusted-hub" pathOptions={hubStyle}>
    <Popup>{hub.name} · Shared safe hub · {hub.radius} m radius · Default boundary coverage</Popup>
  </Circle>);
}
