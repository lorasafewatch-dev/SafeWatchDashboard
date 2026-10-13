import {useEffect,useRef,useState} from 'react';
import {authFlowError,clearRecoveryState,verifyRecoveryLink} from '../authFlow.js';
export default function RecoveryLinkConfirm({client,link,onVerified}){
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const lock=useRef(false);const mounted=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const verify=async()=>{
    if(lock.current)return;lock.current=true;setBusy(true);setError('');
    try{await verifyRecoveryLink(client);if(mounted.current)onVerified();}
    catch(failure){if(mounted.current)setError(authFlowError(failure));}
    finally{lock.current=false;if(mounted.current)setBusy(false);}
  };
  return <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6"><section className="w-full max-w-md rounded-3xl bg-white border border-slate-200 p-8 space-y-5">
    <h1 className="text-2xl font-bold text-slate-800">Reset your password</h1>
    <p className="text-sm text-slate-500">{link.valid?'Confirm this reset request to choose a new password.':'This reset link is invalid. Return to login and request a new email.'}</p>
    {error&&<p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {link.valid&&<button disabled={busy} onClick={verify} className="w-full rounded-xl bg-emerald-600 py-3 font-bold text-white disabled:opacity-50">{busy?'Verifying…':'Continue password reset'}</button>}
    <button disabled={busy} onClick={()=>{clearRecoveryState(client);onVerified();}} className="w-full rounded-xl border border-slate-200 py-3 text-sm font-semibold text-slate-600">Cancel reset</button>
  </section></div>;
}
