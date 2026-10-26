export function clearPrivateBrowserCache(app, browser = globalThis) {
  const prefixes = app === 'family'
    ? ['safewatch.family.alerts.v1:', 'safewatch.family.selected-senior.v1:']
    : ['safewatch.barangay.alerts.v1:'];
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      const storage = browser[name];
      const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
      for (const key of keys) if (prefixes.some(prefix => key?.startsWith(prefix))) storage.removeItem(key);
    } catch { /* Storage can be unavailable; never prevent sign-out. */ }
  }
}

export function installPrivateCacheCleanup(client, app) {
  client.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT') clearPrivateBrowserCache(app);
  });
}
