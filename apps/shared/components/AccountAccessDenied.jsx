import {useRef,useState} from 'react';
import {accountMatchesApp} from '../accountAccess.js';
export default function AccountAccessDenied({client,access,user,app,onRetry}) {
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);const lock=useRef(false);
  const matches=accountMatchesApp(access,app);
  const title=!matches?'This account belongs to the other app':access.status==='pending'?'Awaiting barangay approval':access.status==='suspended'?'Account access suspended':access.status==='rejected'?'Account request not approved':'Confirm your email';
  const message=!matches?`Use a separate ${app==='family'?'family':'barangay'} account to sign in here.`:access.status==='pending'?'Your barangay account is registered. A super admin must approve it before you can open the dashboard.':access.status==='rejected'||access.status==='suspended'?'Contact your barangay administrator to review your access.':'Check your inbox to confirm this account before continuing.';
  return <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6"><section className="max-w-md w-full rounded-3xl border border-slate-200 bg-white p-8 space-y-5">
    <h1 className="text-2xl font-bold text-slate-800">{title}</h1><p className="text-sm text-slate-500 break-all">{user.email}</p><p className="text-sm text-slate-600">{message}</p>
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    {matches&&<button disabled={busy} onClick={onRetry} className="w-full bg-emerald-600 py-3 rounded-xl font-bold text-white">Check access again</button>}
    <button disabled={busy} onClick={async()=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const{error}=await client.auth.signOut({scope:'local'});if(error)throw error;}catch(failure){setError(failure.message||'Could not sign out. Retry.');}finally{lock.current=false;setBusy(false);}}} className="w-full border border-slate-200 py-3 rounded-xl font-semibold text-slate-600">Sign out and use another account</button>
  </section></div>;
}
