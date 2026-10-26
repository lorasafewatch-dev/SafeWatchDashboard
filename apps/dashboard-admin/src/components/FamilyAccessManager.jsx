import { useEffect, useRef, useState } from 'react';
import { listFamilyLinksForStaff, listFamilyRequestsForStaff, revokeFamilyAccess, reviewFamilyRequest, seniorManagementError } from '../../../shared/familySeniors.js';

export default function FamilyAccessManager({ client }) {
  const [requests, setRequests] = useState([]);
  const [links, setLinks] = useState([]);
  const [revokeChoice, setRevokeChoice] = useState(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [choice, setChoice] = useState(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    const load = () => Promise.all([listFamilyRequestsForStaff(client), listFamilyLinksForStaff(client)]).then(([rows, approved]) => { if (active) { setRequests(rows); setLinks(approved); setError(''); } })
      .catch(error => { if (active) setError(seniorManagementError(error)); })
      .finally(() => { if (active) setLoading(false); });
    load();
    const timer = setInterval(load, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [client, revision]);
  const decide = async () => {
    if (!choice || locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      await reviewFamilyRequest(client, choice.request.id, choice.decision);
      if (mounted.current) { setChoice(null); setRevision(value => value + 1); }
    } catch (error) { if (mounted.current) setError(seniorManagementError(error)); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  };
  const revoke = async () => {
    if (!revokeChoice || locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { await revokeFamilyAccess(client, revokeChoice.user_id, revokeChoice.device_id); if (mounted.current) { setRevokeChoice(null); setRevision(value => value + 1); } }
    catch (error) { if (mounted.current) setError(seniorManagementError(error)); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  };
  return <section className="bg-white rounded-3xl border border-slate-100 p-6 md:p-8 space-y-5" aria-labelledby="family-access-title">
    <div className="flex flex-wrap justify-between gap-3"><div>
      <h3 id="family-access-title" className="text-xl font-bold text-slate-800">Family watch access</h3>
      <p className="mt-2 text-sm text-slate-500">Verify the physical Watch ID and the applicant’s relationship to the senior. A family may have multiple approved seniors.</p>
    </div><button disabled={busy} onClick={() => setRevision(value => value + 1)} className="text-sm font-bold text-emerald-700 underline">Refresh requests</button></div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {choice && <div role="group" aria-label="Confirm family access decision" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 space-y-3">
      <p className="text-sm text-amber-900">{choice.decision === 'approve' ? `Grant ${choice.request.applicant_email} access to this senior’s health, location, and alerts?` : 'Reject this access request?'}</p>
      <p className="text-xs text-amber-900">Existing senior records and other approved family links are preserved.</p>
      <div className="flex gap-3"><button disabled={busy} onClick={decide} className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Confirm decision'}</button><button disabled={busy} onClick={() => setChoice(null)} className="px-4 py-3 text-sm font-bold text-slate-600">Cancel decision</button></div>
    </div>}
    {revokeChoice && <div role="group" aria-label="Confirm family access revocation" className="rounded-2xl border border-red-200 bg-red-50 p-5 space-y-3">
      <p className="text-sm text-red-800">Remove {revokeChoice.applicant_email}’s access to {revokeChoice.senior_name}? Their other approved seniors stay available.</p>
      <div className="flex gap-3"><button disabled={busy} onClick={revoke} className="rounded-xl bg-red-600 px-4 py-3 text-sm font-bold text-white">Confirm revocation</button><button disabled={busy} onClick={() => setRevokeChoice(null)} className="text-sm font-bold text-slate-600">Cancel revocation</button></div>
    </div>}
    {loading ? <p role="status" className="text-sm text-slate-500">Loading family requests…</p> : <div className="space-y-3">
      {requests.filter(request => request.status === 'pending').map(request => <article key={request.id} className="rounded-2xl border border-slate-100 p-5 space-y-3">
        <div><h4 className="font-bold text-slate-800">{request.registered_name || request.requested_name || 'Watch registration required'}</h4>
          <p className="mt-1 text-sm text-slate-600">{request.applicant_name} · {request.applicant_email}</p>
          <p className="mt-2 text-xs text-slate-500 break-all">Watch ID: {request.device_id}</p>
          {request.kind === 'register' && <p className="mt-2 text-xs text-slate-500">Submitted name: {request.requested_name} · Age {request.requested_age ?? 'not provided'} · {request.requested_gender}</p>}
          {request.registered_name && request.kind === 'register' && <p className="mt-2 text-xs text-amber-700">This watch is already registered. Approval links the existing senior and preserves their details.</p>}
        </div>
        <div className="flex gap-3"><button disabled={busy} onClick={() => { setRevokeChoice(null); setChoice({ request, decision: 'approve' }); }} className="rounded-xl bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700">Approve access</button><button disabled={busy} onClick={() => { setRevokeChoice(null); setChoice({ request, decision: 'reject' }); }} className="rounded-xl bg-red-50 px-4 py-2 text-sm font-bold text-red-700">Reject request</button></div>
      </article>)}
      {!requests.some(request => request.status === 'pending') && <p className="text-sm text-slate-500">No pending family access requests.</p>}
    </div>}
    {!loading && <div className="border-t border-slate-100 pt-5 space-y-3">
      <h4 className="font-bold text-slate-800">Current family links</h4>
      <p className="text-sm text-slate-500">Review existing relationships as well as new approvals. Revoking a link removes access to that senior only.</p>
      {links.map(link => <div key={`${link.user_id}:${link.device_id}`} className="rounded-2xl border border-slate-100 p-4 flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-sm font-bold text-slate-700">{link.senior_name}</p><p className="text-sm text-slate-500">{link.applicant_name} · {link.applicant_email}</p><p className="text-xs text-slate-400 break-all mt-1">{link.device_id}</p></div>
        <button disabled={busy} onClick={() => { setChoice(null); setRevokeChoice(link); }} className="text-sm font-semibold text-red-700 underline">Revoke access</button>
      </div>)}
      {!links.length && <p className="text-sm text-slate-500">No approved family links.</p>}
    </div>}
  </section>;
}
