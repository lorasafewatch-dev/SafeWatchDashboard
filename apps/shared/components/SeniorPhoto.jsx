import { useContext, useEffect, useState } from 'react';
import { SENIOR_AVATAR } from '../avatar.js';
import { SeniorPhotoContext } from '../seniorPhotoContext.js';

export default function SeniorPhoto({ senior = {}, deviceId, className = '', fallback = SENIOR_AVATAR }) {
  const { client, seniors } = useContext(SeniorPhotoContext);
  const record = seniors.find(item => item.id === (deviceId || senior.id || senior.deviceId));
  const path = record ? record.photo_path : senior.photo_path;
  const [photo, setPhoto] = useState(null);
  useEffect(() => {
    let active = true, url;
    if (client && path) {
      // Authenticated download checks Storage RLS. No public or signed photo URLs.
      client.storage.from('senior-photos').download(path).then(({ data, error }) => {
        if (active && !error && data) { url = URL.createObjectURL(data); setPhoto({ path, url }); }
      }).catch(() => { /* The existing avatar remains available. */ });
    }
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [client, path]);
  return <img src={photo && photo.path === path ? photo.url : fallback} alt="" className={`senior-photo ${className}`} onError={event => { event.currentTarget.src = fallback; }}/>;
}
