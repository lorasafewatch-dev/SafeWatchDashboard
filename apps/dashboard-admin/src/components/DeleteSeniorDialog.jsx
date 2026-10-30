import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { deleteSeniorWatch, seniorManagementError } from '../../../shared/familySeniors.js';

export default function DeleteSeniorDialog({ client, senior, onCancel, onDeleted }) {
  const dialog = useRef(null);
  const cancelButton = useRef(null);
  const locked = useRef(false);
  const mounted = useRef(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    mounted.current = true;
    const previousFocus = document.activeElement;
    dialog.current.showModal();
    cancelButton.current.focus();
    return () => { mounted.current = false; previousFocus?.focus(); };
  }, []);

  const remove = async event => {
    event.preventDefault();
    if (locked.current || confirmation !== 'DELETE') return;
    locked.current = true; setBusy(true); setError('');
    try {
      const id = await deleteSeniorWatch(client, senior.id, confirmation);
      if (mounted.current) onDeleted(id);
    } catch (failure) {
      if (mounted.current) setError(seniorManagementError(failure));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return <dialog ref={dialog} className="admin-delete-dialog" aria-labelledby="delete-senior-title" aria-describedby="delete-senior-description"
    onCancel={event => { event.preventDefault(); if (!locked.current) onCancel(); }}>
    <form onSubmit={remove} className="space-y-5">
      <div className="flex items-center gap-3 text-red-700"><Trash2 aria-hidden="true" className="w-6 h-6 shrink-0"/><h2 id="delete-senior-title" className="text-xl font-bold">Delete senior and watch?</h2></div>
      <div><p className="font-bold text-slate-800 break-words">{senior.name}</p><p className="text-xs text-slate-500 break-all mt-1">Watch ID: {senior.id}</p></div>
      <p id="delete-senior-description" className="text-sm text-slate-600">This permanently deletes this senior’s profile, watch registration, health and location history, alerts, and family access requests. All family accounts will lose access to this watch. This cannot be undone.</p>
      <p className="text-sm text-slate-600">The physical watch is unchanged. Register it again before using it for another senior.</p>
      <div><label htmlFor="delete-senior-confirmation" className="block text-sm font-bold text-slate-700 mb-2">Type DELETE to confirm</label>
        <input id="delete-senior-confirmation" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} autoComplete="off" spellCheck={false} className="input-field" aria-describedby={error ? 'delete-senior-error' : undefined}/></div>
      {error && <p id="delete-senior-error" role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap justify-end gap-3">
        <button ref={cancelButton} type="button" disabled={busy} onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600 disabled:opacity-50">Cancel</button>
        <button type="submit" disabled={busy || confirmation !== 'DELETE'} className="rounded-xl bg-red-600 px-4 py-3 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50">{busy ? 'Deleting…' : 'Permanently delete senior'}</button>
      </div>
    </form>
  </dialog>;
}
