export async function requireAccount(client, expectedUserId) {
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  if (!data?.user) throw new Error('Please sign in again to manage your account.');
  if (expectedUserId && data.user.id !== expectedUserId) {
    throw new Error('Your signed-in account has changed. Reload before continuing.');
  }
  return data.user;
}

export const verifiedFactors = user => (user?.factors || []).filter(factor => factor.status === 'verified');

export async function readAccountAccess(client, expectedUserId) {
  const user = await requireAccount(client, expectedUserId);
  const factors = verifiedFactors(user);
  if (!factors.length) return { user, factors, allowed: true };
  const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  return { user, factors, allowed: data?.currentLevel === 'aal2' };
}

export function validatePasswordChange({ currentPassword, password, confirmation, nonce = '' }) {
  if (!currentPassword) throw new Error('Enter your current password.');
  if (typeof password !== 'string' || password.length < 8) throw new Error('Use at least 8 characters for your new password.');
  if (password !== confirmation) throw new Error('The new passwords do not match.');
  if (password === currentPassword) throw new Error('Choose a password different from your current password.');
  if (nonce && !/^\d{6}$/.test(nonce.trim())) throw new Error('Enter the 6-digit security code.');
  return { current_password: currentPassword, password, ...(nonce ? { nonce: nonce.trim() } : {}) };
}

export async function changeAccountPassword(client, draft, expectedUserId, verifyCurrentPassword) {
  const attributes = validatePasswordChange(draft);
  const user = await requireAccount(client, expectedUserId);
  if (!verifyCurrentPassword) throw new Error('The current-password check is unavailable. Reload and try again.');
  // Check credentials in an isolated Auth client so the active MFA session is preserved.
  await verifyCurrentPassword(user.email, attributes.current_password, user.id);
  await requireAccount(client, user.id);
  const { data, error } = await client.auth.updateUser(attributes);
  if (error) throw error;
  if (data?.user?.id !== user.id) throw new Error('Your password update could not be verified. Please sign in again.');
  return data.user;
}

export async function sendPasswordSecurityCode(client, expectedUserId) {
  await requireAccount(client, expectedUserId);
  const { error } = await client.auth.reauthenticate();
  if (error) throw error;
}

export async function beginAuthenticator(client, expectedUserId) {
  const user = await requireAccount(client, expectedUserId);
  if (verifiedFactors(user).some(factor => factor.factor_type === 'totp')) {
    throw new Error('An authenticator is already enabled. Reload your security settings.');
  }
  // Remove only abandoned, unverified setups created by this application.
  for (const factor of user.factors || []) {
    if (factor.factor_type === 'totp' && factor.status === 'unverified' && factor.friendly_name === 'SafeWatch authenticator') {
      const { error } = await client.auth.mfa.unenroll({ factorId: factor.id });
      if (error) throw error;
    }
  }
  const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'SafeWatch authenticator', issuer: 'SafeWatch' });
  if (error) throw error;
  if (!data?.id || !data.totp?.qr_code || !data.totp?.secret) throw new Error('Authenticator setup could not be loaded. Please retry.');
  return data;
}

export async function verifyAuthenticator(client, factorId, code, expectedUserId) {
  if (!/^\d{6}$/.test(code.trim())) throw new Error('Enter the 6-digit code from your authenticator.');
  const user = await requireAccount(client, expectedUserId);
  if (!(user.factors || []).some(factor => factor.id === factorId && factor.factor_type === 'totp')) {
    throw new Error('This authenticator is no longer linked to your account. Reload and try again.');
  }
  const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
  if (error) throw error;
  const access = await readAccountAccess(client, user.id);
  if (!access.allowed || !access.factors.some(factor => factor.id === factorId)) {
    throw new Error('Authenticator verification could not be confirmed. Please retry.');
  }
  return access;
}

export async function removeAuthenticator(client, factorId, code, expectedUserId) {
  await verifyAuthenticator(client, factorId, code, expectedUserId);
  const { error } = await client.auth.mfa.unenroll({ factorId });
  if (error) throw error;
  const user = await requireAccount(client, expectedUserId);
  if ((user.factors || []).some(factor => factor.id === factorId)) throw new Error('Authenticator removal could not be verified. Reload your security settings.');
  return user;
}

export async function cancelAuthenticator(client, factorId, expectedUserId) {
  const user = await requireAccount(client, expectedUserId);
  const factor = (user.factors || []).find(item => item.id === factorId);
  if (!factor) return;
  if (factor.status !== 'unverified' || factor.factor_type !== 'totp') throw new Error('Only an unfinished authenticator setup can be canceled.');
  const { error } = await client.auth.mfa.unenroll({ factorId });
  if (error) throw error;
}

export function accountSecurityError(error) {
  if (['reauthentication_needed', 'reauth_nonce_missing', 'reauthentication_not_valid'].includes(error?.code)) {
    return 'Request a security code, then enter the code from your email or phone and retry.';
  }
  if (error?.code === 'mfa_verification_failed') return 'That authenticator code was not accepted. Try the current code from your app.';
  return error?.message || 'Your account could not be updated. Check your connection and retry.';
}
