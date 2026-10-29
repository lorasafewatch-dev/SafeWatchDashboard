import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Loader2, Pencil, Shield, Users } from 'lucide-react';
import { familyProfileFromUser, saveFamilyProfile } from '../../../shared/familyProfile.js';
import { accountSecurityError, changeAccountPassword, sendPasswordSecurityCode, verifiedFactors } from '../../../shared/accountSecurity.js';
import {accountRoleLabel} from '../../../shared/accountAccess.js';
import AccountAccessManager from './AccountAccessManager.jsx';
import FamilyAccessManager from './FamilyAccessManager.jsx';
import AccountAuthenticator from '../../../shared/components/AccountAuthenticator.jsx';

const inputClass = 'mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 focus:outline-2 focus:outline-emerald-500 disabled:opacity-50';
const primaryClass = 'rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50';
const secondaryClass = 'rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50';
const emptyPassword = { currentPassword: '', password: '', confirmation: '', nonce: '' };
const Row = ({ label, value }) => <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 py-4 last:border-0">
  <span className="text-sm text-slate-500">{label}</span><span className="text-sm font-semibold text-slate-800 break-all">{value}</span>
</div>;
const Field = ({ label, children, help }) => <label className="block text-sm font-semibold text-slate-600">{label}{children}{help && <span className="block mt-2 text-xs font-normal text-slate-500">{help}</span>}</label>;
const Notice = ({ error, message }) => <>{error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}{message && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}</>;

export default function AccountSettings({ client, user: accountUser, permission, onUpdated, verifyCurrentPassword }) {
  const [user, setUser] = useState(accountUser);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ fullName: '', email: '', phoneNumber: '' });
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordDraft, setPasswordDraft] = useState(emptyPassword);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState('');
  const [profileError, setProfileError] = useState('');
  const [profileMessage, setProfileMessage] = useState('');
  const [securityError, setSecurityError] = useState('');
  const [securityMessage, setSecurityMessage] = useState('');
  const locked = useRef(false);
  const mounted = useRef(false);
  const profile = familyProfileFromUser(user);
  const factors = verifiedFactors(user);
  const role = accountRoleLabel(permission?.role);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setUser(accountUser); }, [accountUser]);

  const run = async (actionName, action, profileAction = false) => {
    if (locked.current) return;
    locked.current = true; setBusy(actionName);
    const setError = profileAction ? setProfileError : setSecurityError;
    const setMessage = profileAction ? setProfileMessage : setSecurityMessage;
    setError(''); setMessage('');
    try { await action(); }
    catch (error) { if (mounted.current) setError(accountSecurityError(error)); }
    finally { locked.current = false; if (mounted.current) setBusy(''); }
  };
  const update = nextUser => { if (mounted.current) { setUser(nextUser); onUpdated(); } };
  const edit = () => {
    setDraft({ fullName: profile.fullName, email: profile.pendingEmail || profile.email, phoneNumber: profile.phoneNumber });
    setProfileError(''); setProfileMessage(''); setEditing(true);
  };

  return <div className="admin-settings p-5 md:p-8 grid grid-cols-1 lg:grid-cols-2 gap-8 flex-1 overflow-y-auto items-start">
    <section aria-labelledby="account-profile-title" className="bg-white p-6 md:p-10 rounded-[2.5rem] shadow-sm border border-slate-100 space-y-6">
      <div className="flex items-center gap-5"><div className="p-4 bg-emerald-50 text-emerald-600 rounded-3xl"><Users className="w-8 h-8" /></div>
        <div><h3 id="account-profile-title" className="text-xl font-bold text-slate-800">Profile Information</h3><p className="mt-1 text-sm text-slate-500">View and update your personal information.</p></div>
      </div>
      <Notice error={profileError} message={profileMessage} />
      {profile.pendingEmail && <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 break-all">Awaiting email confirmation: <strong>{profile.pendingEmail}</strong>. Your current email stays active until confirmed.</p>}
      {editing ? <form onSubmit={event => { event.preventDefault(); run('profile', async () => {
        const result = await saveFamilyProfile(client, draft, { expectedUserId: user.id, emailRedirectTo: window.location.origin });
        if (!mounted.current) return;
        update(result.user); setEditing(false);
        setProfileMessage(result.profile.pendingEmail ? 'Profile saved. Check your current and new inboxes to confirm your email change.' : result.changed ? 'Your profile has been saved.' : 'Your profile is already up to date.');
      }, true); }} className="space-y-5">
        <Field label="Full name"><input autoFocus required maxLength={100} autoComplete="name" disabled={!!busy} value={draft.fullName} onChange={event => setDraft(value => ({ ...value, fullName: event.target.value }))} className={inputClass} /></Field>
        <Field label="Email address" help="An email change may require confirmation in both inboxes."><input type="email" required maxLength={254} autoComplete="email" disabled={!!busy} value={draft.email} onChange={event => setDraft(value => ({ ...value, email: event.target.value }))} className={inputClass} /></Field>
        <Field label="Phone number" help="Optional contact number."><input type="tel" maxLength={30} autoComplete="tel" disabled={!!busy} value={draft.phoneNumber} onChange={event => setDraft(value => ({ ...value, phoneNumber: event.target.value }))} className={inputClass} /></Field>
        <Row label="Role" value={role} />
        <p className="text-xs text-slate-500">Your role is assigned by your administrator.</p>
        <div className="flex flex-wrap gap-3"><button disabled={!!busy} className={primaryClass}>{busy === 'profile' ? 'Saving…' : 'Save profile'}</button><button type="button" disabled={!!busy} onClick={() => { setEditing(false); setProfileError(''); }} className={secondaryClass}>Cancel profile editing</button></div>
      </form> : <><div><Row label="Name" value={profile.fullName || 'Add your full name'} /><Row label="Role" value={role} /><Row label="Email" value={profile.email} /><Row label="Phone" value={profile.phoneNumber || 'No phone number added'} /></div>
        <button disabled={!!busy} onClick={edit} className={`${secondaryClass} w-full flex items-center justify-center gap-2 border-emerald-500 text-emerald-700`}><Pencil className="w-4 h-4" /> Edit Profile</button></>}
    </section>

    <section aria-labelledby="account-security-title" className="bg-white p-6 md:p-10 rounded-[2.5rem] shadow-sm border border-slate-100 space-y-6">
      <div className="flex items-center gap-5"><div className="p-4 bg-emerald-50 text-emerald-600 rounded-3xl"><Shield className="w-8 h-8" /></div><div><h3 id="account-security-title" className="text-xl font-bold text-slate-800">Account Security</h3><p className="mt-1 text-sm text-slate-500">Manage your password and account security.</p></div></div>
      <Notice error={securityError} message={securityMessage} />
      <div><Row label="Last sign-in" value={user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : 'Not available'} /><Row label="Two-Factor Authentication" value={factors.length ? 'On' : 'Off'} /></div>
      <AccountAuthenticator client={client} user={user} required onUpdated={onUpdated} />

      {passwordOpen ? <form onSubmit={event => { event.preventDefault(); run('password', async () => {
        const nextUser = await changeAccountPassword(client, passwordDraft, user.id, verifyCurrentPassword);
        if (!mounted.current) return;
        update(nextUser); setPasswordDraft(emptyPassword); setShowPassword(false); setPasswordOpen(false); setSecurityMessage('Your password has been changed. Use the new password the next time you sign in.');
      }); }} className="space-y-4 border-t border-slate-100 pt-5">
        <Field label="Current password"><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" required disabled={!!busy} value={passwordDraft.currentPassword} onChange={event => setPasswordDraft(value => ({ ...value, currentPassword: event.target.value }))} className={inputClass} /></Field>
        <Field label="New password" help="Use at least 8 characters. Your account may require a stronger password."><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={8} disabled={!!busy} value={passwordDraft.password} onChange={event => setPasswordDraft(value => ({ ...value, password: event.target.value }))} className={inputClass} /></Field>
        <Field label="Confirm new password"><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" required disabled={!!busy} value={passwordDraft.confirmation} onChange={event => setPasswordDraft(value => ({ ...value, confirmation: event.target.value }))} className={inputClass} /></Field>
        <button type="button" disabled={!!busy} onClick={() => setShowPassword(value => !value)} className="text-sm font-semibold text-emerald-700 flex items-center gap-2">{showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}{showPassword ? 'Hide passwords' : 'Show passwords'}</button>
        <Field label="Security code (if requested)" help="If a security code is required, request one and enter it here."><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" disabled={!!busy} value={passwordDraft.nonce} onChange={event => setPasswordDraft(value => ({ ...value, nonce: event.target.value }))} className={inputClass} /></Field>
        <button type="button" disabled={!!busy} onClick={() => run('security-code', async () => { await sendPasswordSecurityCode(client, user.id); if (mounted.current) setSecurityMessage('Security code requested. Check your account email or phone.'); })} className="text-sm text-emerald-700 font-semibold underline">Send security code</button>
        <div className="flex flex-wrap gap-3"><button disabled={!!busy} className={primaryClass}>{busy === 'password' ? 'Updating…' : 'Update password'}</button><button type="button" disabled={!!busy} onClick={() => { setPasswordDraft(emptyPassword); setShowPassword(false); setPasswordOpen(false); setSecurityError(''); setSecurityMessage(''); }} className={secondaryClass}>Cancel password change</button></div>
      </form> : <button disabled={!!busy} onClick={() => { setPasswordOpen(true); setSecurityError(''); setSecurityMessage(''); }} className={`${secondaryClass} w-full border-emerald-500 text-emerald-700`}>Change Password</button>}
      {busy && <p role="status" className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Updating your account…</p>}
    </section>
    <div className="lg:col-span-2"><FamilyAccessManager client={client}/></div>
    {permission?.role==='super_admin'&&<div className="lg:col-span-2"><AccountAccessManager client={client} userId={user.id} onUpdated={onUpdated}/></div>}
  </div>;
}
