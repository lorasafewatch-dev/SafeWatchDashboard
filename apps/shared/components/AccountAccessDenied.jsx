import {useState} from 'react';
import {accountMatchesApp} from '../accountAccess.js';
import LogoutConfirmation from './LogoutConfirmation.jsx';
export default function AccountAccessDenied({client,access,user,app,onRetry,className='',header,children}) {
  const [logoutRequested,setLogoutRequested]=useState(false);
  const matches=accountMatchesApp(access,app);
  const title=!matches?'This account belongs to the other app':access.status==='pending'?'Awaiting barangay approval':access.status==='suspended'?'Account access suspended':access.status==='rejected'?'Account request not approved':'Confirm your email';
  const message=!matches?`Use a separate ${app==='family'?'family':'barangay'} account to sign in here.`:access.status==='pending'?'Your barangay account is registered. A super admin must approve it before you can open the dashboard.':access.status==='rejected'||access.status==='suspended'?'Contact your barangay administrator to review your access.':'Check your inbox to confirm this account before continuing.';
  return <div className={`min-h-screen bg-slate-50 flex items-center justify-center p-6 ${className}`}><section aria-labelledby="account-access-title" className="max-w-md w-full rounded-3xl border border-slate-200 bg-white p-8 space-y-5">
    {header}
    <h1 id="account-access-title" className="text-2xl font-bold text-slate-800">{title}</h1><p className="account-access__email text-sm text-slate-500 break-all">{user.email}</p><p className="account-access__message text-sm text-slate-600">{message}</p>
    {children}
    {matches&&<button onClick={onRetry} className="account-access__retry w-full bg-emerald-600 py-3 rounded-xl font-bold text-white">Check access again</button>}
    <button onClick={()=>setLogoutRequested(true)} className="account-access__signout w-full border border-slate-200 py-3 rounded-xl font-semibold text-slate-600">Sign out and use another account</button>
  </section>{logoutRequested&&<LogoutConfirmation client={client} app={app} scope="local" onCancel={()=>setLogoutRequested(false)}/>}</div>;
}
