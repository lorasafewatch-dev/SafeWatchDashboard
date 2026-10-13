import { useEffect,useRef,useState } from 'react';
import { authFlowError,clearRecoveryState,requestPasswordReset,resetRecoveredPassword } from '../authFlow.js';

export default function PasswordRecovery({client,user,recovery,onNotice,onFinished}) {
  const [password,setPassword]=useState(''); const [confirmation,setConfirmation]=useState('');
  const [show,setShow]=useState(false);const [error,setError]=useState('');const [saved,setSaved]=useState(false);
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const locked=useRef(false);
  const mounted=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const run=async action=>{if(locked.current)return;locked.current=true;setBusy(true);setError('');try{await action();}catch(failure){if(mounted.current)setError(authFlowError(failure));}finally{locked.current=false;if(mounted.current)setBusy(false);}};
  const leave=()=>run(async()=>{
    if(saved)onNotice('Password updated. Sign in with your new password.');
    const {error}=await client.auth.signOut({scope:'global'});if(error)throw error;
    clearRecoveryState(client);onFinished();
  });
  const inputClass='mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800';
  return <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6"><section className="w-full max-w-md rounded-3xl bg-white border border-slate-200 p-8 space-y-5">
    <h1 className="text-2xl font-bold text-slate-800">{saved?'Password updated':'Reset your password'}</h1>
    <p className="text-sm text-slate-500">{user?.email}</p>
    {error&&<p role="alert" className="bg-red-50 p-4 rounded-xl text-sm text-red-700">{error}</p>}
    {message&&<p role="status" className="bg-emerald-50 p-4 rounded-xl text-sm text-emerald-800">{message}</p>}
    {saved?<p role="status" className="text-sm text-emerald-800">Your new password has been saved. Return to login to use it.</p>:recovery?.valid?<form onSubmit={event=>{event.preventDefault();run(async()=>{
      await resetRecoveredPassword(client,password,confirmation,user.id);if(mounted.current){setPassword('');setConfirmation('');setSaved(true);}
    });}} className="space-y-4">
      <label className="block text-sm font-semibold text-slate-600">New password<input autoFocus type={show?'text':'password'} autoComplete="new-password" required minLength={8} disabled={busy} value={password} onChange={event=>setPassword(event.target.value)} className={inputClass}/></label>
      <label className="block text-sm font-semibold text-slate-600">Confirm new password<input type={show?'text':'password'} autoComplete="new-password" required disabled={busy} value={confirmation} onChange={event=>setConfirmation(event.target.value)} className={inputClass}/></label>
      <button type="button" disabled={busy} onClick={()=>setShow(value=>!value)} className="text-sm text-emerald-700 font-semibold">{show?'Hide passwords':'Show passwords'}</button>
      <button disabled={busy} className="w-full rounded-xl bg-emerald-600 py-3 font-bold text-white disabled:opacity-50">{busy?'Saving…':'Save new password'}</button>
    </form>:<><p role="alert" className="text-sm text-red-700">This reset link is invalid, expired, or already used. Request a new link.</p>{user?.email&&<button disabled={busy} onClick={()=>run(async()=>{await requestPasswordReset(client,user.email,window.location.origin);if(mounted.current)setMessage('A new reset link has been requested. Check your inbox.');})} className="font-semibold text-emerald-700 underline">Request a new reset link</button>}</>}
    <button disabled={busy} onClick={leave} className="w-full rounded-xl border border-slate-200 py-3 text-sm font-semibold text-slate-600">Return to login</button>
  </section></div>;
}
