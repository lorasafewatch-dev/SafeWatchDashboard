import { useEffect, useRef, useState } from 'react';
import { accountSecurityError, beginAuthenticator, cancelAuthenticator, removeAuthenticator, verifiedFactors, verifyAuthenticator } from '../accountSecurity.js';

export default function AccountAuthenticator({ client, user, required = false, onUpdated }) {
  const [enrollment, setEnrollment] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const locked = useRef(false);
  const mounted = useRef(false);
  const factors = verifiedFactors(user).filter(factor => factor.factor_type === 'totp');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const run = async action => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(''); setMessage('');
    try { await action(); }
    catch (error) { if (mounted.current) setError(accountSecurityError(error)); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  };
  const input = <label className="block text-sm font-semibold text-slate-600">Authenticator code
    <input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} disabled={busy}
      onChange={event => setCode(event.target.value.replace(/\D/g, ''))} className="mt-2 w-full rounded-xl border border-slate-200 p-3" />
  </label>;
  return <section className="space-y-4" aria-label="Authenticator setup">
    <p className="text-sm text-slate-600">{required ? 'Barangay accounts require an authenticator app before accessing senior records.' : 'Use an authenticator app to add a second sign-in step.'}</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
    {enrollment ? <form className="space-y-4" onSubmit={event => { event.preventDefault(); run(async () => {
      await verifyAuthenticator(client, enrollment.id, code, user.id);
      if (mounted.current) { setCode(''); setEnrollment(null); onUpdated(); }
    }); }}>
      <p className="text-sm text-slate-600">Scan this QR code in your authenticator, then enter its current code. Keep the setup key private.</p>
      <img src={`data:image/svg+xml,${encodeURIComponent(enrollment.totp.qr_code)}`} width="192" height="192" alt="Authenticator setup QR code" />
      <details className="text-sm text-slate-600"><summary>Enter a setup key instead</summary><code className="mt-2 block break-all select-all">{enrollment.totp.secret}</code></details>
      {input}
      <div className="flex flex-wrap gap-3"><button disabled={busy} className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Verifying…' : 'Enable authenticator'}</button>
        <button type="button" disabled={busy} onClick={() => run(async () => { await cancelAuthenticator(client, enrollment.id, user.id); if (mounted.current) { setEnrollment(null); setCode(''); } })} className="text-sm text-slate-600 underline">Cancel setup</button></div>
    </form> : !factors.length ? <button disabled={busy} onClick={() => run(async () => { const next = await beginAuthenticator(client, user.id); if (mounted.current) setEnrollment(next); })}
      className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Preparing…' : 'Set up authenticator'}</button>
      : required ? <p className="text-sm font-semibold text-emerald-700">Authenticator enabled. It is required for barangay access.</p>
      : <form className="space-y-3" onSubmit={event => { event.preventDefault(); run(async () => {
        await removeAuthenticator(client, factors[0].id, code, user.id); if (mounted.current) { setCode(''); setMessage('Authenticator removed.'); onUpdated(); }
      }); }}>{input}<button disabled={busy} className="text-sm font-semibold text-red-700 underline">Remove authenticator</button></form>}
  </section>;
}
