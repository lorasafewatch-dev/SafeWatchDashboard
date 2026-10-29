import { ChevronRight } from 'lucide-react';

export default function StatCard({ value, label, subtext, signal = 100, icon: Icon, onClick, tone = 'green', showSignal = true }) {
  const level = Number.isFinite(signal) ? Math.max(0, Math.min(100, signal)) : 0;
  const activeBars = Math.ceil(level / 25);
  const signalColor = level === 0 ? '#94a3b8' : level <= 25 ? '#dc2626'
    : level <= 50 ? '#ea580c' : level <= 75 ? '#ca8a04' : '#4a7c59';

  const Element = onClick ? 'button' : 'div';
  const textValue = typeof value === 'string' && value !== '—' && Number.isNaN(Number.parseFloat(value));
  return (
    <Element type={onClick ? 'button' : undefined} onClick={onClick} className={`stat-card admin-stat admin-stat--${tone}`}>
      <div className="admin-stat__main">
        {Icon && <span className="admin-stat__icon"><Icon aria-hidden="true" /></span>}
        <div className={`admin-stat__reading${textValue ? ' admin-stat__reading--text' : ''}`}><p>{label}</p><strong>{value}</strong></div>
        {showSignal && <div className="mini-bars" role="img" aria-label={`${label}: ${activeBars} of 4 status bars`} style={{ '--signal-color': signalColor }}>
          {[25, 50, 75, 100].map((height, index) => (
            <div key={height} className={`mini-bar ${index < activeBars ? 'mini-bar-active' : ''}`} style={{ height: `${height}%` }} />
          ))}
        </div>}
      </div>
      <div className="admin-stat__footer"><span>{subtext}</span>{onClick && <ChevronRight aria-hidden="true" />}</div>
    </Element>
  );
}
