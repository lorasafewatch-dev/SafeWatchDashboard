import { useRef, useState } from 'react';
import { accountSecurityError, verifyAuthenticator } from '../accountSecurity.js';
import AccountAuthenticator from './AccountAuthenticator.jsx';

export default function AccountMfaGate({ client, access, error, onVerified }) {
  const factors = access?.factors.filter(factor => factor.factor_type === 'totp') || [];
  const [factorId, setFactorId] = useState(factors[0]?.id || '');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const run = async action => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setMessage('');
    try { await action(); } catch (failure) { setMessage(accountSecurityError(failure)); }
    finally { locked.current = false; setBusy(false); }
  };
  return <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
    <section className="w-full max-w-md bg-white rounded-3xl border border-slate-200 p-8 shadow-sm space-y-5">
      <h1 className="text-2xl font-bold text-slate-800">{access ? 'Two-factor verification' : 'Check your account'}</h1>
      {access?.enrollmentRequired ? <AccountAuthenticator client={client} user={access.user} required onUpdated={onVerified} /> : access ? <>
        <p className="text-sm text-slate-600">Enter the current 6-digit code from your authenticator to continue.</p>
        {factors.length ? <form onSubmit={event => { event.preventDefault(); run(async () => {
          await verifyAuthenticator(client, factorId, code, access.user.id); setCode(''); onVerified();
        }); }} className="space-y-4">
          {factors.length > 1 && <label className="block text-sm text-slate-600">Authenticator
            <select disabled={busy} value={factorId} onChange={event => setFactorId(event.target.value)} className="mt-2 w-full border border-slate-200 p-3 rounded-xl">
              {factors.map(factor => <option key={factor.id} value={factor.id}>{factor.friendly_name || 'Authenticator'}</option>)}
            </select>
          </label>}
          <label className="block text-sm font-semibold text-slate-600">Authenticator code
            <input autoFocus autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required
              value={code} disabled={busy} onChange={event => setCode(event.target.value)} className="mt-2 w-full border border-slate-200 p-3 rounded-xl" />
          </label>
          <button disabled={busy} className="w-full rounded-xl bg-emerald-600 p-3 font-bold text-white disabled:opacity-50">{busy ? 'Verifying…' : 'Verify and continue'}</button>
        </form> : <p role="alert" className="text-sm text-red-700">This account requires another verification method. Use your supported sign-in method or contact your administrator.</p>}
      </> : <><p role="alert" className="text-sm text-red-700">{error}</p><button onClick={onVerified} className="font-bold text-emerald-700 underline">Retry account check</button></>}
      {message && <p role="alert" className="text-sm text-red-700">{message}</p>}
      <button disabled={busy} onClick={() => run(async () => { const { error } = await client.auth.signOut(); if (error) throw error; })} className="text-sm text-slate-600 underline">Sign out</button>
    </section>
  </div>;
}
