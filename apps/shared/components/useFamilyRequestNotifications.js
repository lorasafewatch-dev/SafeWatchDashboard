import { useEffect, useState } from 'react';
import { listFamilyRequestsForStaff, loadFamilyRequests } from '../familySeniors.js';
import { withRequestTimeout } from '../requestTimeout.js';

export default function useFamilyRequestNotifications(client, userId, app) {
  const [result, setResult] = useState({ userId: null, rows: [], error: '' });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    const load = async () => {
      try {
        const rows = await withRequestTimeout(app === 'barangay' ? listFamilyRequestsForStaff(client) : loadFamilyRequests(client), 10000);
        if (active) setResult({ userId, rows, error: '' });
      } catch { if (active) setResult(previous => ({ userId, rows: previous.userId === userId ? previous.rows : [], error: 'Family access notifications could not be refreshed.' })); }
    };
    load(); const timer = setInterval(load, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [client, userId, app, revision]);
  return { requests: result.userId === userId ? result.rows : [], error: result.userId === userId ? result.error : '', refresh: () => setRevision(value => value + 1) };
}
