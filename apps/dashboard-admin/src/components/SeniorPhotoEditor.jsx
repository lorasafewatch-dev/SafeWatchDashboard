import { useId, useRef, useState } from 'react';
import SeniorPhoto from '../../../shared/components/SeniorPhoto.jsx';
import { removeSeniorPhoto, saveSeniorPhoto } from '../../../shared/seniorPhotos.js';
import { dialogKeyboard } from '../../../shared/dialogKeyboard.js';

export function PhotoUploadField({ file, onChange, disabled = false }) {
  const id = useId();
  return <div className="photo-editor"><label htmlFor={id}>Senior profile photo (optional)</label><input id={id} type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={event => onChange(event.target.files?.[0] || null)}/><small>JPEG, PNG, or WebP · up to 2 MB · up to 20 megapixels</small>{file && <span>{file.name}<button type="button" disabled={disabled} onClick={() => { onChange(null); const input = document.getElementById(id); if (input) input.value = ''; }}>Remove selected photo</button></span>}</div>;
}

export default function SeniorPhotoEditor({ client, senior, onSaved, onClose }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  const run = async action => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { await action(); await onSaved(); onClose(); }
    catch (failure) { setError(failure.message || 'The photo could not be saved. Retry.'); }
    finally { locked.current = false; setBusy(false); }
  };
  return <div className="incident-details" onKeyDown={event => dialogKeyboard(event, busy ? null : onClose)}><section role="dialog" aria-modal="true" aria-label="Edit senior photo"><h2>Photo for {senior.name}</h2><div className="senior-feature-person"><SeniorPhoto senior={senior}/><p>Watch ID: {senior.id}</p></div>
    <PhotoUploadField file={file} onChange={setFile} disabled={busy}/>{error && <p role="alert">{error}</p>}
    <div className="photo-editor__actions"><button type="button" disabled={busy || !file} onClick={() => run(() => saveSeniorPhoto(client, senior.id, file))}>{busy ? 'Saving…' : senior.photo_path ? 'Replace photo' : 'Upload photo'}</button>
      {senior.photo_path && <button type="button" disabled={busy} onClick={() => run(() => removeSeniorPhoto(client, senior.id))}>Remove saved photo</button>}<button type="button" autoFocus disabled={busy} onClick={onClose}>Cancel</button></div>
  </section></div>;
}
