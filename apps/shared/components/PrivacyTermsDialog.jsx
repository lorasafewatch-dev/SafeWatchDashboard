import { useEffect, useRef, useState } from 'react';
import { PRIVACY_LAW_URL, PRIVACY_RIGHTS_URL, PRIVACY_TERMS_DATE, PRIVACY_TERMS_VERSION, privacyNoticeSections } from '../privacyTerms.js';

export default function PrivacyTermsDialog({ stage = 'signup', readOnly = false, busy = false, error = '', onAccept, onDecline, onRetry }) {
  const dialog = useRef(null);
  const heading = useRef(null);
  const [terms, setTerms] = useState(false);
  const [accountData, setAccountData] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    heading.current.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);
  return <dialog ref={dialog} aria-labelledby="privacy-terms-title" aria-describedby="privacy-terms-intro"
    onCancel={event => { event.preventDefault(); if (!busy) onDecline(); }}
    className="m-auto w-[calc(100%-1.5rem)] max-w-3xl max-h-[94dvh] rounded-3xl border border-slate-200 bg-white p-0 text-slate-800 shadow-2xl backdrop:bg-slate-950/60">
    <div className="flex max-h-[94dvh] flex-col">
      <header className="shrink-0 border-b border-slate-100 px-5 py-5 sm:px-8">
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">SafeWatch · Your privacy matters</p>
        <h2 ref={heading} tabIndex={-1} id="privacy-terms-title" className="mt-2 text-2xl font-bold focus:outline-none">Terms and Conditions &amp; Privacy Notice</h2>
        <p id="privacy-terms-intro" className="mt-2 text-sm text-slate-600">{readOnly ? 'Review how SafeWatch uses and protects personal data.' : stage === 'signup' ? 'Please review before creating an account. We will ask you to confirm once more at your first login.' : 'Before you continue, please review and confirm. This is required once for your account for this notice version.'}</p>
        <p className="mt-2 text-xs text-slate-500">RA 10173 · Data Privacy Act of 2012 · Effective {PRIVACY_TERMS_DATE}</p>
      </header>
      <div tabIndex={0} role="region" aria-label="Full terms and privacy notice" className="min-h-0 overflow-y-auto overscroll-contain px-5 py-5 sm:px-8">
        <div className="space-y-5 text-sm leading-relaxed text-slate-600">
          {privacyNoticeSections().map(section => <section key={section.title} className="space-y-2">
            <h3 className="font-bold text-slate-800">{section.title}</h3>
            {section.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
          </section>)}
          <p className="flex flex-wrap gap-x-5 gap-y-2"><a href={PRIVACY_LAW_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-emerald-700 underline">Read RA 10173 (NPC)</a><a href={PRIVACY_RIGHTS_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-emerald-700 underline">Your data privacy rights (NPC)</a></p>
        </div>
      </div>
      <form className="shrink-0 space-y-3 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-8" onSubmit={event => {
        event.preventDefault();
        if (!busy && terms && accountData && !readOnly) onAccept({ version: PRIVACY_TERMS_VERSION, terms, accountData });
      }}>
        {!readOnly && <>
          <label className="flex items-start gap-3 text-sm leading-snug text-slate-700"><input type="checkbox" required disabled={busy} checked={terms} onChange={event => setTerms(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600"/><span>I have read and agree to the Terms and Conditions and acknowledge the Privacy Notice.</span></label>
          <label className="flex items-start gap-3 text-sm leading-snug text-slate-700"><input type="checkbox" required disabled={busy} checked={accountData} onChange={event => setAccountData(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600"/><span>I consent to the collection and use of my own account and profile information for registration, authentication, access management and account support as explained above. This does not give consent on behalf of a senior.</span></label>
        </>}
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={busy} onClick={onDecline} className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50">{readOnly ? 'Close notice' : stage === 'signup' ? 'Decline and go back' : 'Decline and sign out'}</button>
          {!readOnly && <button type="submit" disabled={busy || !terms || !accountData || !!error} className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">{busy ? 'Please wait…' : stage === 'signup' ? 'Accept and continue sign-up' : 'Accept and continue'}</button>}
          {onRetry && error && <button type="button" disabled={busy} onClick={onRetry} className="w-full text-sm font-semibold text-emerald-700 underline">Check acceptance again</button>}
        </div>
      </form>
    </div>
  </dialog>;
}
