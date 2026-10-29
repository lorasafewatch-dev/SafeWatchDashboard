import { useRef, useState } from 'react';
import { authFlowError } from '../authFlow.js';
import { acceptPrivacyTerms } from '../privacyTerms.js';
import PrivacyTermsDialog from './PrivacyTermsDialog.jsx';

export default function PrivacyTermsGate({ client, user, app, error: checkError = '', onAccepted, onRetry }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const run = async action => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { await action(); } catch (failure) { setError(authFlowError(failure)); }
    finally { locked.current = false; setBusy(false); }
  };
  return <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
    <p className="text-lg font-bold text-emerald-700">SafeWatch · Review your privacy choices</p>
    <PrivacyTermsDialog stage="first_login" busy={busy} error={error || checkError}
      onRetry={() => { setError(''); onRetry(); }}
      onAccept={acceptance => run(async () => { await acceptPrivacyTerms(client, user.id, app, acceptance); onAccepted(); })}
      onDecline={() => run(async () => { const result = await client.auth.signOut({ scope: 'local' }); if (result.error) throw result.error; })} />
  </div>;
}
