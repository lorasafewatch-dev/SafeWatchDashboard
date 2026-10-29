import './BarangayAuthLayout.css';

export function AuthIcon({ name, className = '', ...props }) {
  const paths = {
    mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2"/></>,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
    eyeOff: <><path d="m3 3 18 18M10.6 5.1A12.4 12.4 0 0 1 12 5c6.5 0 10 7 10 7a20 20 0 0 1-3.1 4.1M6.1 6.1A20.3 20.3 0 0 0 2 12s3.5 7 10 7a11.8 11.8 0 0 0 5.9-1.7M10 10a2.8 2.8 0 0 0 4 4"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></>,
    key: <><circle cx="8" cy="8" r="5"/><path d="m12 12 9 9m-5-5 3-3m-6 0 3-3"/></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
    pulse: <><path d="M20.8 4.7a5.5 5.5 0 0 0-7.8 0l-1 1-1-1a5.5 5.5 0 0 0-7.8 7.8L12 22l8.8-9.5a5.5 5.5 0 0 0 0-7.8Z"/><path d="M2 12h5l2-4 4 9 2-5h7"/></>,
    pin: <><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M9 21h6"/></>,
    shield: <><path d="m12 2 9 4v6c0 5-6 9-9 10-3-1-9-5-9-10V6l9-4Z"/><path d="M12 16s-5-3-5-6a2.8 2.8 0 0 1 5-1.6A2.8 2.8 0 0 1 17 10c0 3-5 6-5 6Z" fill="currentColor" strokeWidth="1"/><path d="m10 11 1.5 1.5L14 10" stroke="var(--auth-heart-check, #effbf5)" strokeWidth="1.3"/></>,
  };
  return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} {...props}>{paths[name]}</svg>;
}

function MonitoringPreview() {
  return <div className="barangay-auth__previews" aria-hidden="true">
    <div className="barangay-auth__preview barangay-auth__preview--health">
      <span className="barangay-auth__preview-icon"><AuthIcon name="pulse"/></span>
      <span className="barangay-auth__preview-title">Health monitoring</span>
      <svg className="barangay-auth__waveform" viewBox="0 0 260 50" fill="none">
        <path d="M2 32h28l7-8 9 17 9-34 9 30 8-12 7 7h36l7-8 9 17 9-34 9 30 8-12 7 7h35l7-8 9 17 9-34 9 30 8-12 7 7h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
    <div className="barangay-auth__preview barangay-auth__preview--location">
      <span className="barangay-auth__preview-icon"><AuthIcon name="pin"/></span>
      <span className="barangay-auth__preview-title">Location tracking</span>
      <svg className="barangay-auth__map" viewBox="0 0 260 106" fill="none">
        <path d="M0 0h260v106H0z" fill="#dff4eb"/>
        <path d="m-20 17 300 75M-20 67 280-8M12-10l90 126M73-10l91 126M145-10l91 126M212-10l70 100M-10 110 114-10M83 116 199-10M179 116 280 3" stroke="#f8fffb" strokeWidth="7"/>
        <circle cx="65" cy="80" r="15" fill="#009a78" fillOpacity=".14"/>
        <circle cx="65" cy="80" r="7" fill="#008875"/>
        <path d="M66 80c24-30 62-5 85-27 8-8 17-16 28-17" stroke="#008875" strokeWidth="3" strokeDasharray="3 6" strokeLinecap="round"/>
        <circle cx="185" cy="35" r="26" fill="#009a78" fillOpacity=".08"/>
        <path d="M201 30c0 12-16 25-16 25s-16-13-16-25a16 16 0 1 1 32 0Z" fill="#008875"/>
        <circle cx="185" cy="29" r="6" fill="#f0fff8"/>
      </svg>
    </div>
  </div>;
}

export default function BarangayAuthLayout({ children, privacyLink }) {
  return <main className="barangay-auth">
    <div className="barangay-auth__background" aria-hidden="true"/>
    <div className="barangay-auth__shell">
      <header className="barangay-auth__header">
        <div className="barangay-auth__brand" aria-label="SafeWatch Barangay Monitoring Portal">
          <AuthIcon name="shield" className="barangay-auth__brand-mark"/>
          <div><span className="barangay-auth__wordmark">SafeWatch</span><span className="barangay-auth__brand-caption">Barangay Monitoring Portal</span></div>
        </div>
        <p className="barangay-auth__tagline">Community care, connected.</p>
      </header>
      <div className="barangay-auth__main">
        <section className="barangay-auth__hero" aria-labelledby="barangay-auth-headline">
          <div className="barangay-auth__intro">
            <p className="barangay-auth__eyebrow">Health · Location · Safety</p>
            <h1 id="barangay-auth-headline">Connected care.<br/><span>Wherever they are.</span></h1>
            <p className="barangay-auth__description">Monitor senior health and location.<br/>Stay informed. Respond with care.</p>
          </div>
          <MonitoringPreview/>
          <ul className="barangay-auth__features" aria-label="SafeWatch features">
            <li><AuthIcon name="pulse"/><span>Health monitoring</span></li>
            <li><AuthIcon name="pin"/><span>Location tracking</span></li>
            <li><AuthIcon name="bell"/><span>Safety alerts</span></li>
          </ul>
        </section>
        {children}
      </div>
      <footer className="barangay-auth__footer">
        <div className="barangay-auth__footer-line"><span>SafeWatch · Barangay Monitoring Portal</span></div>
        {privacyLink}
      </footer>
    </div>
  </main>;
}
