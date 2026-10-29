import { readAccountAccess } from './accountSecurity.js';
import { signupPrivacyDeclaration } from './privacyTerms.js';

const normalizeEmail = value => {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
  return email;
};
export function validateNewPassword(password, confirmation) {
  if (typeof password !== 'string' || password.length < 8) throw new Error('Use at least 8 characters for your password.');
  if (password !== confirmation) throw new Error('The passwords do not match.');
  return password;
}
export function authReturnUrl(origin, recovery = false) {
  const url = new URL('/', origin);
  if (!['http:','https:'].includes(url.protocol)) throw new Error('The app return address is invalid.');
  if (recovery) url.searchParams.set('auth','reset-password');
  return url.href;
}
export async function signInAccount(client, email, password) {
  const cleanEmail = normalizeEmail(email);
  if (!password) throw new Error('Enter your password.');
  const { data, error } = await client.auth.signInWithPassword({email:cleanEmail,password});
  if (error) throw error;
  if (!data?.session || !data?.user) throw new Error('Your sign-in could not be verified. Please retry.');
  clearRecoveryState(client);
  return data;
}
export async function signUpAccount(client, draft, app, origin) {
  if (!['family','dashboard'].includes(app)) throw new Error('Choose a supported application.');
  const fullName = (draft.fullName || '').trim().replace(/\s+/g,' ');
  if (!fullName || fullName.length > 100) throw new Error('Enter a full name of up to 100 characters.');
  const email = normalizeEmail(draft.email);
  const password = validateNewPassword(draft.password,draft.confirmation);
  const privacy = signupPrivacyDeclaration(draft.privacyAcceptance);
  const { data, error } = await client.auth.signUp({email,password,options:{emailRedirectTo:authReturnUrl(origin),data:{full_name:fullName,requested_app:app,...privacy}}});
  if (error) throw error;
  if (!data?.user) throw new Error('Registration could not be verified. Please retry.');
  return data;
}
export async function requestPasswordReset(client, email, origin) {
  const { error } = await client.auth.resetPasswordForEmail(normalizeEmail(email),{redirectTo:authReturnUrl(origin,true)});
  if (error) throw error;
}
export async function resendAccountConfirmation(client,email,origin) {
  const { error } = await client.auth.resend({type:'signup',email:normalizeEmail(email),options:{emailRedirectTo:authReturnUrl(origin)}});
  if (error) throw error;
}
export function authFlowError(error) {
  if (error?.code === 'otp_expired') return 'This reset link or code has expired or was already used. Request a new reset email.';
  if (['over_email_send_rate_limit','over_request_rate_limit'].includes(error?.code)) return 'Too many requests. Please wait a few minutes before trying again.';
  if (error?.code === 'invalid_credentials') return 'Your email or password was not accepted. Please check them and retry.';
  if (error?.code === 'email_not_confirmed') return 'Confirm your email before signing in. You can resend the confirmation below.';
  if ([502,503,504].includes(error?.status) || /bad gateway|service unavailable|gateway timeout/i.test(error?.message || '')) return 'The account service is temporarily unavailable. Wait a moment, then retry.';
  if (/failed to fetch|load failed|networkerror/i.test(error?.message || '')) return 'Could not connect. Check your internet connection and retry.';
  return error?.message || 'Your request could not be completed. Please retry.';
}

const recoveryClients = new WeakMap();
const recoveryKey = 'safewatch.password-recovery.v1';
const sessionId = session => {
  try { return JSON.parse(atob(session.access_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).session_id || null; }
  catch { return null; }
};
export function authRedirectError(url) {
  try {
    const parsed = new URL(url); const hash = new URLSearchParams(parsed.hash.slice(1));
    if (hash.has('error') || parsed.searchParams.has('error')) return 'Your sign-in or reset link is invalid or expired. Request a new link.';
  } catch { /* The SDK validates real callback credentials. */ }
  return '';
}
export function installRecoveryListener(client, options = {}) {
  if (recoveryClients.has(client)) return;
  let storage = null;
  try { storage = options.storage ?? (typeof window !== 'undefined' ? window.sessionStorage : null); } catch { /* Cookies/storage can be blocked. */ }
  const now = options.now || Date.now;
  const url = options.url ?? (typeof window !== 'undefined' ? window.location.href : 'http://localhost/');
  let marker = null;
  try { marker = JSON.parse(storage?.getItem(recoveryKey) || 'null'); } catch { /* Memory tracking still works. */ }
  const parsed=new URL(url);const fragment=new URLSearchParams(parsed.hash.slice(1));
  const linkPresent=fragment.has('token_hash');
  const tokenHash=fragment.get('token_hash')||'';
  const link=linkPresent?{valid:fragment.get('type')==='recovery'&&/^[A-Za-z0-9_-]{16,512}$/.test(tokenHash),tokenHash}:null;
  const state = {marker:linkPresent?null:marker,link,requested:linkPresent||parsed.searchParams.get('auth') === 'reset-password',now,storage,redirectError:authRedirectError(url)};
  recoveryClients.set(client,state);
  client.auth.onAuthStateChange((event,session) => {
    if (event === 'PASSWORD_RECOVERY') {
      markRecoverySession(client,session);
    } else if (event === 'SIGNED_OUT') {
      clearRecoveryState(client); state.redirectError = '';
    } else if (event === 'SIGNED_IN') {
      // The SDK emits SIGNED_IN when restoring an existing session or when a
      // tab regains focus. Keep a recovery flow bound to that same session;
      // an explicit password login clears it in signInAccount instead.
      const sameRecovery = state.marker?.userId === session?.user?.id
        && state.marker?.sessionId === sessionId(session);
      if (!sameRecovery && !(state.requested && !state.marker)) {
        clearRecoveryState(client); state.redirectError = '';
      }
    }
  });
}
export function getRecoveryState(client,session) {
  const state = recoveryClients.get(client);
  if (!state) return null;
  const marker = state.marker;
  if (!state.requested && !marker) return null;
  if (state.redirectError || !marker || !session?.user || marker.userId !== session.user.id || marker.sessionId !== sessionId(session)) return {valid:false};
  const age = state.now() - marker.startedAt;
  return {valid:age >= 0 && age <= 30*60*1000,userId:marker.userId};
}
export function recoveryRedirectError(client) { return recoveryClients.get(client)?.redirectError || ''; }
export function getRecoveryLink(client) { const link=recoveryClients.get(client)?.link;return link?{valid:link.valid}:null; }
function markRecoverySession(client,session) {
  const state=recoveryClients.get(client);if(!state)return;
  const id=sessionId(session);
  state.requested=true;state.redirectError='';state.link=null;
  state.marker=id&&session?.user?.id?{userId:session.user.id,sessionId:id,startedAt:state.now()}:null;
  try{if(state.marker)state.storage?.setItem(recoveryKey,JSON.stringify(state.marker));else state.storage?.removeItem(recoveryKey);}catch{/* Memory tracking still works. */}
  if(typeof window!=='undefined'){
    const url=new URL(window.location.href);const fragment=new URLSearchParams(url.hash.slice(1));
    if(fragment.has('token_hash')){url.hash='';window.history.replaceState(window.history.state,'',url.href);}
  }
}
async function verifyRecovery(client,payload,expectedEmail) {
  const {data,error}=await client.auth.verifyOtp({...payload,type:'recovery'});
  if(error)throw error;
  if(!data?.user?.id||data.session?.user?.id!==data.user.id||!sessionId(data.session))throw new Error('Your reset verification could not be confirmed. Request a new reset email.');
  if(expectedEmail&&data.user.email?.toLowerCase()!==expectedEmail)throw new Error('The reset code does not belong to this email. Request a new reset email.');
  markRecoverySession(client,data.session);
  return data.user;
}
export async function verifyRecoveryLink(client) {
  const link=recoveryClients.get(client)?.link;
  if(!link?.valid)throw new Error('This reset link is invalid. Request a new reset email.');
  return verifyRecovery(client,{token_hash:link.tokenHash});
}
export async function verifyRecoveryCode(client,email,code) {
  const cleanEmail=normalizeEmail(email);const token=typeof code==='string'?code.trim():'';
  if(!/^\d{6}$/.test(token))throw new Error('Enter the 6-digit reset code from your newest email.');
  return verifyRecovery(client,{email:cleanEmail,token},cleanEmail);
}
export function clearRecoveryState(client) {
  const state = recoveryClients.get(client);
  if (!state) return;
  state.marker = null; state.requested = false;state.link=null;
  try { state.storage?.removeItem(recoveryKey); } catch { /* Storage may be unavailable. */ }
  if (typeof window !== 'undefined') {
    const url = new URL(window.location.href);
    for (const key of ['auth','code','error','error_code','error_description']) url.searchParams.delete(key);
    const hash = new URLSearchParams(url.hash.slice(1));
    if (hash.has('error') || hash.has('access_token') || hash.has('type') || hash.has('token_hash')) url.hash = '';
    window.history.replaceState(window.history.state,'',url.href);
  }
}
export async function resetRecoveredPassword(client, password, confirmation, expectedUserId) {
  const next = validateNewPassword(password,confirmation);
  const {data,error} = await client.auth.getSession();
  if (error) throw error;
  if (!getRecoveryState(client,data?.session)?.valid) throw new Error('Your reset link is invalid or expired. Request a new link.');
  const access = await readAccountAccess(client,expectedUserId);
  if (!access.allowed) throw new Error('Complete two-factor verification before resetting your password.');
  const user = access.user;
  if (user.id !== data.session.user.id) throw new Error('Your signed-in account changed. Request a new reset link.');
  const result = await client.auth.updateUser({password:next});
  if (result.error) throw result.error;
  if (result.data?.user?.id !== user.id) throw new Error('Your password reset could not be verified. Please retry.');
  return result.data.user;
}
