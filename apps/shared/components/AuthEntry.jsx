import { useEffect, useRef, useState } from 'react';
import { authFlowError, requestPasswordReset, resendAccountConfirmation, signInAccount, signUpAccount, verifyRecoveryCode } from '../authFlow.js';
import PrivacyTermsDialog from './PrivacyTermsDialog.jsx';

const inputClass = 'mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 focus:outline-2 focus:outline-emerald-500 disabled:opacity-50';
export default function AuthEntry({client,app,initialError='',notice='',onRecovered}) {
  const [mode,setMode]=useState('login');
  const [email,setEmail]=useState(''); const [password,setPassword]=useState('');
  const [confirmation,setConfirmation]=useState(''); const [fullName,setFullName]=useState('');
  const [resetCode,setResetCode]=useState('');
  const [privacyDialog,setPrivacyDialog]=useState(null);
  const [privacyAcceptance,setPrivacyAcceptance]=useState(null);
  const [showPassword,setShowPassword]=useState(false); const [busy,setBusy]=useState(false);
  const [error,setError]=useState(initialError); const [message,setMessage]=useState(notice);
  const [cooldown,setCooldown]=useState(0); const locked=useRef(false); const mounted=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{if(initialError)setError(initialError);},[initialError]);
  useEffect(()=>{if(notice)setMessage(notice);},[notice]);
  useEffect(()=>{if(!cooldown)return;const timer=setInterval(()=>setCooldown(value=>Math.max(0,value-1)),1000);return()=>clearInterval(timer);},[cooldown>0]);
  const run=async action=>{
    if(locked.current)return;locked.current=true;setBusy(true);setError('');setMessage('');
    try{await action();}catch(failure){if(mounted.current)setError(authFlowError(failure));}
    finally{locked.current=false;if(mounted.current)setBusy(false);}
  };
  const changeMode=next=>{if(locked.current)return;setMode(next);setPassword('');setConfirmation('');setResetCode('');setShowPassword(false);setError('');setMessage('');setPrivacyAcceptance(null);setPrivacyDialog(next==='signup'?'signup':null);};
  const submit=event=>{event.preventDefault();run(async()=>{
    if(mode==='login')await signInAccount(client,email,password);
    else if(mode==='signup'){
      if(!privacyAcceptance){setPrivacyDialog('signup');return;}
      const result=await signUpAccount(client,{email,password,confirmation,fullName,privacyAcceptance},app,window.location.origin);
      if(!mounted.current)return;
      setPassword('');setConfirmation('');
      if(!result.session){setMode('login');setMessage(app==='dashboard'
        ? 'Registration requested. Confirm your email, then sign in. Barangay staff accounts also need super-admin approval.'
        : 'Registration requested. Check your inbox to confirm your email before signing in.');}
    }else if(mode==='code'){
      await verifyRecoveryCode(client,email,resetCode);if(mounted.current){setResetCode('');onRecovered?.();}
    }else{
      if(cooldown)return;
      await requestPasswordReset(client,email,window.location.origin);
      if(mounted.current){setCooldown(60);setMessage('If an account exists for this email, a reset link has been requested. Check your inbox and spam folder.');}
    }
  });};
  const dashboard=app==='dashboard';
  return <><div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 md:p-10">
    <div className="w-full max-w-5xl grid lg:grid-cols-2 gap-10 items-center">
      <div className="hidden lg:block space-y-6">
        <p className="text-4xl font-black tracking-tight text-emerald-700">SafeWatch</p>
        <h1 className="text-4xl font-bold leading-tight text-slate-800">{dashboard?'Barangay Health Portal':'Family care, connected'}</h1>
        <p className="text-lg text-slate-500">{dashboard?'Monitor seniors and respond to alerts with your approved barangay account.':'Keep up with your loved ones’ health, location and safety alerts.'}</p>
      </div>
      <section className="w-full max-w-md mx-auto bg-white border border-slate-100 rounded-[2rem] p-7 md:p-10 shadow-sm space-y-6">
        <div><p className="font-black text-emerald-700 mb-3">SafeWatch · {dashboard?'Barangay':'Family'}</p>
          <h2 className="text-3xl font-bold text-slate-800">{mode==='signup'?'Create your account':mode==='forgot'?'Forgot password?':mode==='code'?'Enter reset code':'Welcome back'}</h2>
          <p className="mt-2 text-sm text-slate-500">{mode==='signup'?(dashboard?'Create your barangay account. New staff accounts require super-admin approval. Use a different email from your family account.':'Create a family account using a different email from your barangay account.'):mode==='forgot'?'Enter your account email to request a password-reset link.':mode==='code'?'Enter the 6-digit reset code from your newest password-reset email.':'Sign in with the account for this app.'}</p>
        </div>
        {error&&<p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
        {message&&<p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}
        <form onSubmit={submit} className="space-y-5">
          {mode==='signup'&&<label className="block text-sm font-semibold text-slate-600">Full name<input autoComplete="name" required maxLength={100} disabled={busy} value={fullName} onChange={event=>setFullName(event.target.value)} className={inputClass}/></label>}
          <label className="block text-sm font-semibold text-slate-600">Email address<input type="email" autoComplete={mode==='login'?'username':'email'} required maxLength={254} disabled={busy} value={email} onChange={event=>setEmail(event.target.value)} className={inputClass}/></label>
          {mode==='code'&&<label className="block text-sm font-semibold text-slate-600">Reset code<input type="text" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" maxLength={6} disabled={busy} value={resetCode} onChange={event=>setResetCode(event.target.value.replace(/\D/g,''))} className={inputClass}/></label>}
          {mode!=='forgot'&&mode!=='code'&&<>
            <label className="block text-sm font-semibold text-slate-600">Password<input type={showPassword?'text':'password'} autoComplete={mode==='signup'?'new-password':'current-password'} required minLength={mode==='signup'?8:undefined} disabled={busy} value={password} onChange={event=>setPassword(event.target.value)} className={inputClass}/></label>
            {mode==='signup'&&<><label className="block text-sm font-semibold text-slate-600">Confirm password<input type={showPassword?'text':'password'} autoComplete="new-password" required disabled={busy} value={confirmation} onChange={event=>setConfirmation(event.target.value)} className={inputClass}/></label><p className="text-xs text-slate-500">Use at least 8 characters. Your account may require a stronger password.</p></>}
            <div className="flex flex-wrap justify-between gap-3"><button type="button" disabled={busy} onClick={()=>setShowPassword(value=>!value)} className="text-sm text-emerald-700 font-semibold">{showPassword?'Hide password':'Show password'}</button>{mode==='login'&&<button type="button" disabled={busy} onClick={()=>changeMode('forgot')} className="text-sm font-semibold text-emerald-700">Forgot password?</button>}</div>
          </>}
          {mode==='signup'&&<p className="text-xs text-slate-500">{privacyAcceptance?'Terms accepted for sign-up. You will confirm again at first login.':'Review the terms and account-data consent before signing up.'} <button type="button" disabled={busy} onClick={()=>setPrivacyDialog('signup')} className="font-semibold text-emerald-700 underline">Review sign-up terms</button></p>}
          <button disabled={busy||(mode==='forgot'&&cooldown>0)} className="w-full rounded-2xl bg-emerald-600 py-4 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">{busy?'Please wait…':mode==='signup'?'Sign Up':mode==='code'?'Verify reset code':mode==='forgot'?(cooldown?`Request again in ${cooldown}s`:'Send reset link'):'Log In'}</button>
        </form>
        {(mode==='forgot'||mode==='login')&&<button disabled={busy} onClick={()=>changeMode('code')} className="w-full text-sm font-semibold text-emerald-700 underline">Enter reset code</button>}
        {mode==='login'?<><button disabled={busy} onClick={()=>changeMode('signup')} className="w-full rounded-2xl border border-emerald-500 py-3 font-bold text-emerald-700">Create an account</button>
          <button disabled={busy} onClick={()=>run(async()=>{await resendAccountConfirmation(client,email,window.location.origin);if(mounted.current)setMessage('Confirmation requested. Check your inbox and spam folder.');})} className="w-full text-sm text-slate-500 underline">Resend confirmation email</button></>:<button disabled={busy} onClick={()=>changeMode('login')} className="w-full text-sm font-semibold text-emerald-700">Back to login</button>}
        <button type="button" disabled={busy} onClick={()=>setPrivacyDialog('read')} className="w-full text-xs font-semibold text-slate-500 underline">Terms and Conditions &amp; Privacy Notice</button>
      </section>
    </div>
  </div>{privacyDialog&&<PrivacyTermsDialog key={privacyDialog} readOnly={privacyDialog==='read'} stage="signup"
    onDecline={()=>privacyDialog==='signup'?changeMode('login'):setPrivacyDialog(null)}
    onAccept={acceptance=>{setPrivacyAcceptance(acceptance);setPrivacyDialog(null);}}/>}</>;
}
