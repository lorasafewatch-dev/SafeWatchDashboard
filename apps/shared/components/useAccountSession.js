import { useEffect, useRef, useState } from 'react';
import { readAccountAccess } from '../accountSecurity.js';
import { accountCanUseApp, accountMatchesApp, loadAccountPermission } from '../accountAccess.js';
import { getRecoveryLink, getRecoveryState, installRecoveryListener, recoveryRedirectError } from '../authFlow.js';
import { loadPrivacyAcceptance } from '../privacyTerms.js';

export default function useAccountSession(client, app) {
  const [state, setState] = useState({ loading: true, access: null, error: '' });
  const [notice,setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const accountId = useRef(null);
  const sequence = useRef(0);

  useEffect(() => {
    installRecoveryListener(client);
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY') setNotice('');
      // Auth calls run in the effect, outside Supabase's callback/session lock.
      sequence.current += 1;
      const id = session?.user?.id || null;
      if (!id || id !== accountId.current || event === 'SIGNED_IN') {
        setState({ loading: !!id, access: null, error: '' });
      }
      accountId.current = id;
      setRevision(value => value + 1);
    });
    return () => { sequence.current += 1; subscription.unsubscribe(); };
  }, [client]);

  useEffect(() => {
    if (!state.access?.user) return;
    const timer = setInterval(() => setRevision(value => value + 1),15000);
    return () => clearInterval(timer);
  }, [state.access?.user.id]);

  useEffect(() => {
    let active = true;
    const request = ++sequence.current;
    (async () => {
      const recoveryLink=getRecoveryLink(client);
      if(recoveryLink)return{access:null,recoveryLink,recovery:null,linkError:''};
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (!data?.session) return {access:null,recovery:getRecoveryState(client,null),linkError:recoveryRedirectError(client)};
      const access = await readAccountAccess(client, data.session.user.id);
      const permission = await loadAccountPermission(client,access.user.id);
      const recovery = getRecoveryState(client,data.session);
      const linkError = recoveryRedirectError(client);
      let privacyReceipt = null; let privacyError = '';
      if (accountMatchesApp(permission,app) && !recovery && !linkError) {
        try { privacyReceipt = await loadPrivacyAcceptance(client,access.user.id,app); }
        catch (failure) { privacyError = failure.message || 'Unable to check privacy acceptance. Please retry.'; }
      }
      return {access,permission,recovery,linkError,privacyReceipt,privacyError};
    })().then(result => {
      if (active && request === sequence.current) {
        accountId.current = result.access?.user.id || null;
        setState({ loading: false, ...result, error: '' });
      }
    }).catch(error => {
      if (active && request === sequence.current) setState({ loading: false, access: null, error: error.message || 'Unable to check your account. Please retry.' });
    });
    return () => { active = false; };
  }, [client, revision, app]);

  const roleAllowed = accountCanUseApp(state.permission,app);
  const matches = accountMatchesApp(state.permission,app);
  const recoveryAccess = state.recovery && (!state.access || matches) ? {user:state.access?.user,recovery:state.recovery} : null;
  const enrollmentRequired = !!state.access && matches && state.permission?.requested_app === 'dashboard' && !state.access.factors.length;
  const needsMfa = state.access && (!state.access.allowed || enrollmentRequired) && (roleAllowed || matches && state.recovery?.valid);
  const privacyRequired = !!state.access && matches && !state.recovery && !state.linkError && !state.privacyReceipt;
  return { isLoadingAuth: state.loading, isLoggedIn: !!state.access?.allowed && !enrollmentRequired && roleAllowed && !state.recovery && !state.linkError && !!state.privacyReceipt,
    userId: state.access?.user.id || null, accountUser: state.access?.user,
    accountPermission:state.permission, recoveryAccess,recoveryLink:state.recoveryLink,
    accessDenied:state.access && !roleAllowed && !(matches && state.recovery) ? state.permission : null,
    pendingAccess:needsMfa ? { ...state.access, enrollmentRequired } : null,
    privacyRequired, privacyError:state.privacyError,
    authLinkError:state.linkError, authNotice:notice, setAuthNotice:setNotice,
    authError: state.error, retryAuth: () => setRevision(value => value + 1) };
}
