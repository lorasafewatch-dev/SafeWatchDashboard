import { createClient } from '@supabase/supabase-js';
import { installRecoveryListener } from '../../shared/authFlow.js';

let client;
export function getDashboardClient() {
  if (!client) {
    client = createClient(import.meta.env.VITE_SUPABASE_URL || 'https://your-project.supabase.co',
      import.meta.env.VITE_SUPABASE_ANON_KEY || 'your-anon-key');
    installRecoveryListener(client);
  }
  return client;
}

export async function verifyDashboardPassword(email, password, expectedUserId) {
  const verifier = createClient(import.meta.env.VITE_SUPABASE_URL || 'https://your-project.supabase.co',
    import.meta.env.VITE_SUPABASE_ANON_KEY || 'your-anon-key', { auth: {
      persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
      storageKey: `safewatch.password-check.${crypto.randomUUID()}`,
    } });
  try {
    const { data, error } = await verifier.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (data?.user?.id !== expectedUserId) throw new Error('Your current password could not be verified for this account.');
  } finally {
    await verifier.auth.signOut({ scope: 'local' });
  }
}
