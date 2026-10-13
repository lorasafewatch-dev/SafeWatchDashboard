import { requireAccount } from './accountSecurity.js';

export const accountRoleLabel = role => ({family:'Family member',barangay:'Barangay staff',super_admin:'Super admin'}[role] || 'Access not assigned');
export function accountCanUseApp(access, app) {
  return ['family','dashboard'].includes(app) && access?.requested_app === app && access.status === 'approved' && access.email_confirmed === true
    && (app === 'family' ? access.role === 'family' : ['barangay','super_admin'].includes(access.role));
}
export function accountMatchesApp(access, app) { return access?.requested_app === app; }
export async function loadAccountPermission(client, expectedUserId) {
  const { data, error } = await client.rpc('get_safewatch_account_access');
  if (error) {
    if (['PGRST202','42883'].includes(error.code)) throw new Error('Account permissions need to be configured by your administrator.');
    throw error;
  }
  if (data?.user_id !== expectedUserId || !['family','dashboard'].includes(data?.requested_app) || !['family','barangay','super_admin'].includes(data?.role)
    || !['pending','approved','rejected','suspended'].includes(data?.status)) throw new Error('Your account permissions could not be verified. Please retry.');
  return data;
}
export async function listDashboardAccounts(client, expectedUserId) {
  await requireAccount(client, expectedUserId);
  const { data, error } = await client.rpc('list_safewatch_dashboard_accounts');
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('Account requests could not be loaded.');
  return data;
}
export async function reviewDashboardAccount(client, userId, decision, expectedUserId) {
  const status = {approve:'approved',reject:'rejected',suspend:'suspended'}[decision];
  if (!userId || !status) throw new Error('Choose an account and valid review action.');
  await requireAccount(client, expectedUserId);
  const { data, error } = await client.rpc('review_safewatch_dashboard_account',{p_user_id:userId,p_decision:decision});
  if (error) throw error;
  if (data?.user_id !== userId || data.status !== status || data.role !== 'barangay') throw new Error('The account review could not be verified. Reload the list.');
  return data;
}
export async function transferSuperAdmin(client, userId, expectedUserId) {
  const user = await requireAccount(client, expectedUserId);
  if (!userId || userId === user.id) throw new Error('Choose another approved barangay account.');
  const { data, error } = await client.rpc('transfer_safewatch_super_admin',{p_user_id:userId});
  if (error) throw error;
  if (data?.super_admin !== userId || data.previous_super_admin !== user.id) throw new Error('The transfer result could not be verified. Reload your account permissions.');
  return data;
}
