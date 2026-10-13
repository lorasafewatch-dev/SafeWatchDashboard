export default function StatCard({ value, label, subtext, signal = 100 }) {
  const level = Number.isFinite(signal) ? Math.max(0, Math.min(100, signal)) : 0;
  const activeBars = Math.ceil(level / 25);
  const signalColor = level === 0 ? '#94a3b8' : level <= 25 ? '#dc2626'
    : level <= 50 ? '#ea580c' : level <= 75 ? '#ca8a04' : '#4a7c59';

  return (
    <div className="stat-card">
      <div className="flex justify-between items-start">
        <p className="text-xs font-medium text-gray-400">{label}</p>
        <div className="mini-bars" role="img" aria-label={`${label}: ${activeBars} of 4 status bars`} style={{ '--signal-color': signalColor }}>
          {[25, 50, 75, 100].map((height, index) => (
            <div key={height} className={`mini-bar ${index < activeBars ? 'mini-bar-active' : ''}`} style={{ height: `${height}%` }} />
          ))}
        </div>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold text-gray-800 tracking-tight">{value}</span>
      </div>
      <p className="text-[11px] text-gray-400">{subtext}</p>
    </div>
  );
}
