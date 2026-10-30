import { ArrowRightLeft, Check, Clock3, LockKeyhole, Mail, ShieldCheck, ShieldAlert } from 'lucide-react';
import AccountAccessDenied from '../../../shared/components/AccountAccessDenied.jsx';
import { accountMatchesApp } from '../../../shared/accountAccess.js';
import './AdminMfaGate.css';
import './AdminAccessDenied.css';

export default function AdminAccessDenied(props) {
  const matches = accountMatchesApp(props.access, 'dashboard');
  const pending = matches && props.access.status === 'pending';
  const Icon = !matches ? ArrowRightLeft : pending ? Clock3 : props.access.email_confirmed === false ? Mail : ShieldAlert;

  return <main className="admin-verification admin-access" aria-label="SafeWatch account access">
    <div className="admin-verification__background" aria-hidden="true" />
    <header className="admin-verification__brand" aria-label="SafeWatch Barangay Portal">
      <span className="admin-verification__brand-mark"><ShieldCheck aria-hidden="true" /></span>
      <div><strong>SafeWatch</strong><span>Barangay portal</span></div>
    </header>
    <div className="admin-verification__content">
      <AccountAccessDenied {...props} app="dashboard" className="admin-access__gate" header={
        <div className="admin-access__identity">
          <span className="admin-access__icon"><Icon aria-hidden="true" /></span>
          <span>{pending ? 'Account review' : 'Account access'}</span>
        </div>
      }>
        {pending && <ol className="admin-access__progress" aria-label="Account approval progress">
          <li className="admin-access__step admin-access__step--complete">
            <span className="admin-access__step-icon"><Check aria-hidden="true" /></span>
            <span>Account registered</span>
          </li>
          <li className="admin-access__step admin-access__step--current" aria-current="step">
            <span className="admin-access__step-icon"><Clock3 aria-hidden="true" /></span>
            <span>Administrator review</span>
          </li>
          <li className="admin-access__step">
            <span className="admin-access__step-icon"><LockKeyhole aria-hidden="true" /></span>
            <span>Dashboard access</span>
          </li>
        </ol>}
      </AccountAccessDenied>
    </div>
    <footer className="admin-verification__footer"><ShieldCheck aria-hidden="true" /><span>SafeWatch · Barangay Monitoring Portal</span></footer>
  </main>;
}
