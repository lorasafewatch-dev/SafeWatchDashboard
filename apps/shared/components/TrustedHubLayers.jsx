import { Circle, Popup } from 'react-leaflet';
import { safeLocationAppearance, safeLocationAssignment } from '../trustedHubs.js';

export default function TrustedHubLayers({ hubs = [], seniorName }) {
  return hubs.map(hub => <Circle key={hub.id} center={[hub.lat, hub.lng]} radius={hub.radius} className="watch-trusted-hub" pathOptions={{ ...safeLocationAppearance(hub.device_id), fillOpacity: .17, weight: 3 }}>
    <Popup><strong>{hub.name}</strong><br/>{safeLocationAssignment(hub.device_id, hub.seniorName ?? seniorName)}<br/>{hub.radius.toLocaleString()} m radius</Popup>
  </Circle>);
}
