import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Camera, Check, ImagePlus, LoaderCircle, LockKeyhole, Trash2, Upload, X } from 'lucide-react';
import SeniorPhoto from './SeniorPhoto.jsx';
import { removeSeniorPhoto, saveSeniorPhoto } from '../seniorPhotos.js';
import { dialogKeyboard } from '../dialogKeyboard.js';
import './SeniorPhotoEditor.css';

const photoSize = bytes => bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function PhotoUploadField({ file, onChange, disabled = false, inputRef }) {
  const id = useId();
  const localInput = useRef(null);
  const control = inputRef || localInput;
  return <div className="senior-photo-upload">
    <div className="senior-photo-upload__label"><label htmlFor={id}>Senior profile photo</label><span>Optional</span></div>
    <input hidden ref={control} id={id} type="file" accept="image/jpeg,image/png,image/webp" aria-describedby={`${id}-help`} disabled={disabled} onChange={event => {
      const next = event.target.files?.[0];
      if (next) onChange(next);
      event.target.value = '';
    }}/>
    <div className={`senior-photo-upload__box${file ? ' has-photo' : ''}`}>
      <span className="senior-photo-upload__icon" aria-hidden="true">{file ? <Check/> : <Upload/>}</span>
      <div className="senior-photo-upload__copy"><strong>{file ? file.name : 'A familiar face, a little closer'}</strong><p>{file ? `${photoSize(file.size)} · Selected image` : 'Choose a clear photo of the senior.'}</p></div>
      <button type="button" className="senior-photo-button senior-photo-button--choose" disabled={disabled} onClick={() => control.current?.click()}><ImagePlus aria-hidden="true"/>{file ? 'Change photo' : 'Choose photo'}</button>
    </div>
    <div className="senior-photo-upload__help"><p id={`${id}-help`}>JPEG, PNG, or WebP · up to 2 MB · up to 20 megapixels</p>{file && <button type="button" disabled={disabled} onClick={() => onChange(null)}><X aria-hidden="true"/>Clear selection</button>}</div>
  </div>;
}

function PhotoPreview({ selection, senior }) {
  const [unavailable, setUnavailable] = useState(false);
  if (!selection || unavailable) return <SeniorPhoto senior={senior} className="senior-photo-dialog__avatar"/>;
  return <img className="senior-photo-dialog__avatar" src={selection.url} alt="Selected photo preview" onError={() => setUnavailable(true)}/>;
}

export default function SeniorPhotoEditor({ client, senior, onSaved, onClose }) {
  const [selection, setSelection] = useState(null);
  const [action, setAction] = useState(null);
  const [error, setError] = useState('');
  const titleId = useId();
  const input = useRef(null);
  const closeButton = useRef(null);
  const previewUrl = useRef(null);
  const locked = useRef(false);
  const file = selection?.file || null;
  const busy = action !== null;
  const name = senior.name || senior.patient_name;
  useEffect(() => {
    const opener = document.activeElement;
    closeButton.current?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);
  useEffect(() => () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);
  const choose = next => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = next ? URL.createObjectURL(next) : null;
    setSelection(next ? { file: next, url: previewUrl.current } : null);
    setError('');
  };
  const run = async (kind, save) => {
    if (locked.current) return;
    locked.current = true; setAction(kind); setError('');
    try { await save(); await onSaved(kind); onClose(); }
    catch (failure) { setError(failure.message || 'The photo could not be saved. Retry.'); }
    finally { locked.current = false; setAction(null); }
  };
  return createPortal(<div className="senior-photo-dialog" onKeyDown={event => dialogKeyboard(event, busy ? null : onClose)}>
    <section role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} className="senior-photo-dialog__window">
      <header className="senior-photo-dialog__header"><span className="senior-photo-dialog__heading-icon"><ImagePlus aria-hidden="true"/></span><div><p>Senior profile</p><h2 id={titleId}>Edit senior photo</h2></div><button ref={closeButton} type="button" className="senior-photo-dialog__close" aria-label="Close photo editor" disabled={busy} onClick={onClose}><X aria-hidden="true"/></button></header>
      <div className="senior-photo-dialog__body">
        <div className="senior-photo-dialog__person"><div className="senior-photo-dialog__preview"><PhotoPreview key={selection?.url || 'saved'} selection={selection} senior={senior}/><button type="button" className="senior-photo-dialog__camera" aria-label="Choose a photo for this senior" disabled={busy} onClick={() => input.current?.click()}><Camera aria-hidden="true"/></button></div><div className="senior-photo-dialog__identity"><h3>{name}</h3><span className="senior-photo-dialog__caption">{selection ? 'New photo preview' : senior.photo_path ? 'Current profile photo' : 'Default avatar'}</span><p>Watch ID</p><code>{senior.id}</code></div></div>
        <PhotoUploadField file={file} onChange={choose} disabled={busy} inputRef={input}/>
        {error && <p role="alert" className="senior-photo-dialog__error"><AlertCircle aria-hidden="true"/>{error}</p>}
        <p className="senior-photo-dialog__privacy"><LockKeyhole aria-hidden="true"/>Visible to approved family members and authorized staff.</p>
      </div>
      <footer className="senior-photo-dialog__footer"><div>{senior.photo_path && <button type="button" className="senior-photo-button senior-photo-button--remove" disabled={busy} onClick={() => run('remove', () => removeSeniorPhoto(client, senior.id))}>{action === 'remove' ? <LoaderCircle className="is-spinning" aria-hidden="true"/> : <Trash2 aria-hidden="true"/>}{action === 'remove' ? 'Removing…' : 'Remove photo'}</button>}</div><div className="senior-photo-dialog__save-actions"><button type="button" className="senior-photo-button senior-photo-button--cancel" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="senior-photo-button senior-photo-button--save" disabled={busy || !file} onClick={() => run('save', () => saveSeniorPhoto(client, senior.id, file))}>{action === 'save' ? <LoaderCircle className="is-spinning" aria-hidden="true"/> : <Check aria-hidden="true"/>}{action === 'save' ? 'Saving…' : 'Save photo'}</button></div></footer>
  </section></div>, document.body);
}
