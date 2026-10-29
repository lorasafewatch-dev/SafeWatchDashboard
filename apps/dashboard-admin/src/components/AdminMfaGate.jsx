import { ShieldCheck, LockKeyhole } from 'lucide-react';
import AccountMfaGate from '../../../shared/components/AccountMfaGate.jsx';
import './AdminMfaGate.css';

export default function AdminMfaGate(props) {
  return <main className="admin-verification" aria-label="SafeWatch account verification">
    <div className="admin-verification__background" aria-hidden="true" />
    <header className="admin-verification__brand" aria-label="SafeWatch Barangay Portal">
      <span className="admin-verification__brand-mark"><ShieldCheck aria-hidden="true" /></span>
      <div><strong>SafeWatch</strong><span>Barangay portal</span></div>
    </header>
    <div className="admin-verification__content">
      <AccountMfaGate {...props} className="admin-verification__gate" header={
        <div className="admin-verification__identity">
          <span className="admin-verification__icon"><LockKeyhole aria-hidden="true" /></span>
          <p>{props.access?.enrollmentRequired ? 'Authenticator setup' : 'Account verification'}</p>
        </div>
      } />
    </div>
    <footer className="admin-verification__footer"><ShieldCheck aria-hidden="true" /><span>SafeWatch · Barangay Monitoring Portal</span></footer>
  </main>;
}
