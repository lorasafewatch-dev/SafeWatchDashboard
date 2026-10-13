import {useEffect,useRef,useState} from 'react';
import {accountRoleLabel,listDashboardAccounts,reviewDashboardAccount,transferSuperAdmin} from '../../../shared/accountAccess.js';

export default function AccountAccessManager({client,userId,onUpdated}) {
  const [accounts,setAccounts]=useState([]);const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
  const [choice,setChoice]=useState(null);const [revision,setRevision]=useState(0);
  const lock=useRef(false);const mounted=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    let active=true;setLoading(true);setError('');
    listDashboardAccounts(client,userId).then(rows=>{if(active)setAccounts(rows);}).catch(failure=>{if(active)setError(failure.message||'Could not load account requests.');}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[client,userId,revision]);
  const confirm=async()=>{
    if(lock.current||!choice)return;lock.current=true;setBusy(true);setError('');setMessage('');
    try{
      if(choice.action==='transfer'){
        await transferSuperAdmin(client,choice.account.user_id,userId);
        if(!mounted.current)return;setChoice(null);setMessage('Super-admin access has been transferred. Your account retains barangay access.');onUpdated();
      }else{
        const result=await reviewDashboardAccount(client,choice.account.user_id,choice.action,userId);
        if(!mounted.current)return;setAccounts(rows=>rows.map(row=>row.user_id===result.user_id?{...row,...result}:row));
        setChoice(null);setMessage('Account access has been updated.');
      }
    }catch(failure){if(mounted.current)setError(failure.message||'The access change could not be saved.');}
    finally{lock.current=false;if(mounted.current)setBusy(false);}
  };
  const choose=(account,action)=>{setChoice({account,action});setError('');setMessage('');};
  const buttonClass='rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40';
  return <section aria-labelledby="access-manager-title" className="bg-white border border-slate-100 rounded-[2rem] p-6 md:p-10 space-y-6">
    <div className="flex flex-wrap justify-between gap-4"><div><h3 id="access-manager-title" className="text-xl font-bold text-slate-800">Barangay account access</h3><p className="mt-2 text-sm text-slate-500">Approve account requests, suspend access, or transfer the super-admin role.</p></div><button disabled={busy||loading} onClick={()=>setRevision(value=>value+1)} className={buttonClass}>Refresh accounts</button></div>
    {error&&<p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {message&&<p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}
    {choice&&<div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 space-y-4">
      <p className="text-sm font-semibold text-amber-900">{choice.action==='transfer'?`Transfer super-admin access to ${choice.account.email}? You will retain barangay access and lose approval/transfer controls.`:`${{approve:'Approve dashboard access for',reject:'Reject the account request for',suspend:'Suspend dashboard access for'}[choice.action]} ${choice.account.email}?`}</p>
      <div className="flex flex-wrap gap-3"><button disabled={busy} onClick={confirm} className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{busy?'Saving…':choice.action==='transfer'?'Confirm super-admin transfer':'Confirm access change'}</button><button disabled={busy} onClick={()=>setChoice(null)} className={buttonClass}>Cancel access change</button></div>
    </div>}
    {loading?<p role="status" className="text-sm text-slate-500">Loading account requests…</p>:<div className="space-y-3">
      {accounts.map(account=><div key={account.user_id} role="group" aria-label={`Account request ${account.email}`} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-100 p-5">
        <div className="min-w-0"><p className="font-semibold text-slate-800">{account.full_name||'Barangay applicant'}</p><p className="mt-1 text-sm text-slate-500 break-all">{account.email}</p><p className="mt-2 text-xs font-semibold text-slate-500">{accountRoleLabel(account.role)} · {account.status} · {account.email_confirmed?'Email confirmed':'Email not confirmed'}</p></div>
        {account.role==='barangay'&&account.user_id!==userId&&<div className="flex flex-wrap gap-2">
          {account.status!=='approved'&&<button disabled={busy||!account.email_confirmed} onClick={()=>choose(account,'approve')} className={buttonClass}>Approve</button>}
          {account.status==='pending'&&<button disabled={busy} onClick={()=>choose(account,'reject')} className={buttonClass}>Reject</button>}
          {account.status==='approved'&&<><button disabled={busy} onClick={()=>choose(account,'suspend')} className={buttonClass}>Suspend</button><button disabled={busy||!account.email_confirmed} onClick={()=>choose(account,'transfer')} className={buttonClass}>Transfer super admin</button></>}
        </div>}
      </div>)}
      {!accounts.length&&!error&&<p className="text-sm text-slate-500">No barangay account requests yet.</p>}
    </div>}
  </section>;
}
