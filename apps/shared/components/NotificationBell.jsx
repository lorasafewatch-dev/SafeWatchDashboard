import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, CheckCheck, RefreshCw, X } from 'lucide-react';
import { buildBellNotifications, loadReadNotifications, markNotificationsRead, notificationStorageKey, unreadNotifications } from '../notificationCenter.js';
import './NotificationBell.css';

const storage = () => { try { return globalThis.localStorage; } catch { return null; } };
const formatTime = value => Number.isFinite(Date.parse(value)) ? `${new Date(value).toLocaleString('en-PH', {
  timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
})} PHT` : 'Time unavailable';

export function NotificationPanel({ id, notifications, readIds, loading, error, onClose, onOpen, onRefresh, onReadAll, onViewAll, panelRef, style }) {
  const unread = new Set(unreadNotifications(notifications, readIds).map(item => item.key));
  return <section ref={panelRef} id={id} className="watch-notifications__panel" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} style={style}>
    <header className="watch-notifications__heading"><div><h2 id={`${id}-title`}>Notifications</h2><p>{unread.size} unread · {notifications.filter(item => item.active).length} active alerts</p></div><button type="button" onClick={onClose} aria-label="Close notifications"><X aria-hidden="true"/></button></header>
    <div className="watch-notifications__tools"><button type="button" disabled={!unread.size} onClick={onReadAll}><CheckCheck aria-hidden="true"/>Mark all as read</button><button type="button" disabled={loading} onClick={onRefresh}><RefreshCw aria-hidden="true"/>Refresh</button></div>
    {loading && <p className="watch-notifications__notice" role="status">Checking notifications…</p>}
    {error && <p className="watch-notifications__error" role="alert">{error}</p>}
    {!loading && !error && !notifications.length && <div className="watch-notifications__empty"><Bell aria-hidden="true"/><h3>No notifications yet</h3><p>Watch alerts and SOS responses will appear here.</p></div>}
    <ul className="watch-notifications__list" aria-label="Watch notifications">{notifications.map(item => <li key={item.key}>
      <button type="button" className={`watch-notifications__item${unread.has(item.key) ? ' is-unread' : ''}`} onClick={() => onOpen(item)}>
        <span className="watch-notifications__item-top"><strong>{item.name}</strong><span>{unread.has(item.key) ? 'Unread' : 'Read'}</span></span>
        <span className="watch-notifications__title">{item.title}</span>
        {item.message !== item.title && <span className="watch-notifications__message">{item.message}</span>}
        <time dateTime={item.at}>{formatTime(item.at)}</time><span className="watch-notifications__action">{item.active ? 'Review active alert' : 'View SOS response'}</span>
      </button>
    </li>)}</ul>
    <footer><p>Reading notifications does not confirm an SOS.</p><button type="button" onClick={onViewAll}>View all alerts and responses</button></footer>
  </section>;
}

export default function NotificationBell({ app = 'family', userId, alerts = [], responses = [], loading = false, blocked = false, error = '', onRefresh, onOpenNotification, onViewAll, className = '' }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ top: 72, right: 16 });
  const storageKey = notificationStorageKey(app, userId);
  const [readIds, setReadIds] = useState(() => loadReadNotifications(storage(), storageKey));
  const trigger = useRef(null);
  const panel = useRef(null);
  const id = useId();
  const notifications = useMemo(() => buildBellNotifications(alerts, responses, userId), [alerts, responses, userId]);
  const unreadCount = unreadNotifications(notifications, readIds).length;
  const close = () => setOpen(false);

  useEffect(() => {
    const sync = event => { if (event.key === storageKey || event.key === null) setReadIds(loadReadNotifications(storage(), storageKey)); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [storageKey]);

  useEffect(() => {
    if (!open || blocked) return;
    const button = trigger.current;
    panel.current?.querySelector('button')?.focus();
    const keyboard = event => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); return; }
      if (event.key !== 'Tab') return;
      const buttons = [...(panel.current?.querySelectorAll('button:not(:disabled)') || [])];
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const resize = () => setOpen(false);
    document.addEventListener('keydown', keyboard);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('keydown', keyboard); window.removeEventListener('resize', resize);
      if (!document.querySelector('[role="alertdialog"], [aria-modal="true"]')) button?.focus();
    };
  }, [open, blocked]);

  const markRead = keys => setReadIds(previous => markNotificationsRead(previous, keys, storage(), storageKey));
  const openItem = item => { markRead([item.key]); close(); onOpenNotification?.(item); };
  return <>
    <button type="button" ref={trigger} disabled={blocked} className={`watch-notification-bell ${className}`} aria-label={`Notifications (${unreadCount} unread)`} aria-expanded={open && !blocked} aria-haspopup="dialog" aria-controls={open && !blocked ? id : undefined} onClick={() => {
      const bounds = trigger.current.getBoundingClientRect();
      setAnchor({ top: Math.max(12, Math.min(bounds.bottom+10, window.innerHeight-280)), right: Math.max(12, window.innerWidth-bounds.right) });
      setOpen(value => !value); onRefresh?.();
    }}><Bell aria-hidden="true"/>{unreadCount > 0 && <span className="watch-notification-bell__count" aria-hidden="true">{unreadCount > 99 ? '99+' : unreadCount}</span>}</button>
    {open && !blocked && createPortal(<div className="watch-notifications"><button type="button" tabIndex={-1} className="watch-notifications__backdrop" aria-label="Close notification panel" onClick={close}/>
      <NotificationPanel id={id} panelRef={panel} notifications={notifications} readIds={readIds} loading={loading} error={error} onClose={close} onOpen={openItem} onRefresh={onRefresh}
        onReadAll={() => markRead(notifications.map(item => item.key))} onViewAll={() => { close(); onViewAll?.(); }}
        style={{ top: anchor.top, right: anchor.right, maxHeight: `calc(100dvh - ${anchor.top+16}px)` }}/>
    </div>, document.body)}
  </>;
}
