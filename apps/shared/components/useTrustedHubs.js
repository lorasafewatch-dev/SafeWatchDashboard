import { useCallback, useEffect, useRef, useState } from 'react';
import { loadTrustedHubs } from '../trustedHubs.js';

const empty = [];

export default function useTrustedHubs(client, userId) {
  const [state, setState] = useState(null);
  const current = useRef(null);

  const refresh = useCallback(async () => {
    const scope = current.current;
    if (!scope || scope.pending) return;
    scope.pending = true;
    const version = scope.version;
    try {
      const hubs = await loadTrustedHubs(client);
      if (current.current === scope && scope.version === version) setState({ scope, hubs, error: '' });
    } catch {
      if (current.current === scope && scope.version === version) {
        setState(previous => ({ scope, hubs: previous?.scope === scope ? previous.hubs : empty, error: 'Shared safe hubs could not be refreshed.' }));
      }
    } finally {
      scope.pending = false;
      if (current.current === scope && scope.version !== version) refresh();
    }
  }, [client]);

  useEffect(() => {
    if (!userId) return;
    current.current = { client, userId, pending: false, version: 0 };
    refresh();
    const timer = setInterval(refresh, 5000);
    window.addEventListener('online', refresh);
    return () => {
      current.current = null;
      clearInterval(timer);
      window.removeEventListener('online', refresh);
    };
  }, [client, userId, refresh]);

  const applySavedHub = (id, hub) => {
    const scope = current.current;
    if (!scope || scope.client !== client || scope.userId !== userId) return;
    scope.version += 1;
    setState(previous => ({ scope, error: '', hubs: [
      ...(previous?.scope === scope ? previous.hubs : empty).filter(item => item.id !== id),
      ...(hub ? [hub] : []),
    ] }));
    refresh();
  };

  const visible = state?.scope.client === client && state.scope.userId === userId;
  return { hubs: visible ? state.hubs : empty, error: visible ? state.error : '', applySavedHub, refresh };
}
