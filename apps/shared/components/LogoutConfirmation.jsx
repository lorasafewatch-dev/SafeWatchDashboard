import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, LogOut, ShieldCheck } from 'lucide-react';
import './LogoutConfirmation.css';

export default function LogoutConfirmation({ client, app, scope, onCancel, onLoggedOut = onCancel }) {
  const dialog = useRef(null);
  const cancelButton = useRef(null);
  const locked = useRef(false);
  const mounted = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const id = useId();

  useEffect(() => {
    mounted.current = true;
    const element = dialog.current;
    const previousFocus = document.activeElement;
    if (!element.open) element.showModal();
    cancelButton.current.focus();
    return () => {
      mounted.current = false;
      if (element.open) element.close();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  const confirm = async () => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const { error: failure } = await client.auth.signOut(scope ? { scope } : undefined);
      if (failure) throw failure;
      if (mounted.current) onLoggedOut();
    } catch {
      if (mounted.current) setError('We couldn’t log you out. Please check your connection and try again.');
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return <dialog ref={dialog} className="sw-logout-confirm" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-busy={busy}
    onCancel={event => { event.preventDefault(); if (!locked.current) onCancel(); }}>
    <div className="sw-logout-confirm__brand"><ShieldCheck aria-hidden="true"/><span>SafeWatch{app ? ` · ${app === 'dashboard' ? 'Barangay portal' : 'Family'}` : ''}</span></div>
    <div className="sw-logout-confirm__icon"><LogOut aria-hidden="true"/></div>
    <h2 id={`${id}-title`}>Log out of SafeWatch?</h2>
    <p id={`${id}-description`}>Are you sure you want to log out of your account? You can sign in again any time.</p>
    {error && <p role="alert" className="sw-logout-confirm__error">{error}</p>}
    <div className="sw-logout-confirm__actions">
      <button ref={cancelButton} type="button" disabled={busy} onClick={onCancel} className="sw-logout-confirm__cancel">Cancel</button>
      <button type="button" disabled={busy} onClick={confirm} className="sw-logout-confirm__submit" aria-label={busy ? 'Logging out' : 'Confirm logout'}>
        {busy ? <Loader2 className="sw-logout-confirm__spinner" aria-hidden="true"/> : <LogOut aria-hidden="true"/>}{busy ? 'Logging out…' : 'Confirm'}
      </button>
    </div>
  </dialog>;
}
