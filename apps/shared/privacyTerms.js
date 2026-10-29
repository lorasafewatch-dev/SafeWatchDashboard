import { requireAccount } from './accountSecurity.js';

// Keep the version in sync with the privacy migration. Archive each published
// notice before changing its meaning so a receipt identifies the text accepted.
export const PRIVACY_TERMS_VERSION = '2026-10-29';
export const PRIVACY_TERMS_DATE = '29 October 2026';
export const PRIVACY_LAW_URL = 'https://privacy.gov.ph/data-privacy-act/';
export const PRIVACY_RIGHTS_URL = 'https://privacy.gov.ph/data-subject-rights/';

export function privacyConfig(env = import.meta.env || {}) {
  return {
    controller: env.VITE_PRIVACY_CONTROLLER?.trim() || 'The SafeWatch program operator at your enrolling barangay health office',
    contact: env.VITE_PRIVACY_CONTACT?.trim() || 'Contact the SafeWatch administrator at your enrolling barangay health office for the operator’s identity, Data Protection Officer (DPO), and privacy requests.',
    retention: env.VITE_PRIVACY_RETENTION?.trim() || 'Account and profile information is kept while your account is active and needed to provide the service. Health, location, alert, security and acceptance records are kept only as long as needed for their stated purpose, applicable recordkeeping duties or legal claims. Ask your enrolling barangay health office for the specific retention schedule before enrolling a watch. Records should then be securely deleted or anonymized, subject to required retention and backup expiry.',
  };
}

export function privacyNoticeSections(config = privacyConfig()) {
  return [
    { title: '1. About these terms and the operator', paragraphs: [
      `These Terms and Conditions and Privacy Notice explain use of SafeWatch and the handling of personal data under the Philippine Data Privacy Act of 2012 (Republic Act No. 10173), its Implementing Rules and Regulations, and applicable National Privacy Commission (NPC) issuances. Effective date: ${PRIVACY_TERMS_DATE}.`,
      `The personal information controller responsible for the SafeWatch program is: ${config.controller}. The controller determines why and how program data is used. ${config.contact}`,
    ] },
    { title: '2. Personal data used by SafeWatch', paragraphs: [
      'For an account, SafeWatch processes your name, email address, authentication and verification information, account role and approval status, profile details or photo you choose to supply, and records of accepting these terms. The authentication service handles passwords and security credentials; never share your password or authenticator codes.',
      'For enrolled seniors, the program may process their name, age, gender, watch identifier, authorized family links, heart rate, blood oxygen readings, GPS location and timestamps, device status, SOS events, safety alerts, and response records. Age and health information are sensitive personal information. Location and family links can also reveal private information and must be handled with care.',
      'The apps, watch and gateway send records to the hosted database and authentication service (Supabase). The apps retrieve permitted records to show readings, location, safe-zone checks and alerts. Devices and service providers may also generate technical, authentication and security logs. A map provider receives map-tile requests for the area displayed. The program does not need your account password for a privacy request.',
    ] },
    { title: '3. Purposes and lawful grounds', paragraphs: [
      'Account data is used to register and authenticate users, maintain profiles, approve access, link authorized family members, secure the service and keep acceptance records. Enrolled watch data is used for senior safety monitoring, displaying health and location information, identifying configured safety events, and coordinating authorized follow-up. Collect only information needed for these purposes.',
      'The account consent below covers your own account and profile information for these stated purposes. Other processing requires an applicable lawful ground under Section 12 of RA 10173. Health and other sensitive personal information requires purpose-specific prior consent from the data subject or a legally authorized representative, or an applicable exception under Section 13. Any reliance on an emergency or other exception must meet its legal conditions.',
      'Creating an account, being a relative, or receiving barangay access is not by itself the senior’s consent or proof of legal authority. Obtain and document the senior’s informed consent or the representative’s lawful authority before enrollment, monitoring or sharing their information. This account pop-up does not record a senior’s separate monitoring consent.',
    ] },
    { title: '4. Authorized access and disclosure', paragraphs: [
      'Approved family users may access the seniors linked to their accounts. Authorized barangay health staff and administrators may access records within their assigned care, safety and administration duties. Access approval does not permit unrelated browsing, copying or disclosure.',
      'Data may be processed by authorized hosting, authentication and technical providers under appropriate safeguards, and disclosed to authorized responders or public authorities when necessary and legally permitted. The operator remains accountable for its processors and any transfers, including processing outside the Philippines. These terms do not authorize advertising, sale of personal data, or unrelated research; any new purpose needs its own lawful basis and notice.',
    ] },
    { title: '5. Retention and security', paragraphs: [
      config.retention,
      'The operator must maintain appropriate organizational, physical and technical safeguards, restrict access, review permissions, and respond to security incidents in accordance with applicable law, including required notifications. Users must protect credentials, use required two-factor verification, sign out on shared devices, and promptly report suspected misuse. No service can promise absolute security.',
    ] },
    { title: '6. Your privacy rights and choices', paragraphs: [
      'Subject to applicable legal conditions, you may request information about processing, access to your data, correction, objection, blocking or erasure, and data portability. You may seek damages where available and lodge a complaint with the National Privacy Commission. Accepting these terms does not waive these rights.',
      `You may withdraw consent for processing that relies on consent and ask to close your account or stop monitoring by making a privacy request. ${config.contact} The operator may verify your identity and authority using only necessary information. Withdrawal affects future consent-based processing; it does not undo earlier lawful processing. Limited processing may continue where another legal ground requires or permits it, and the operator should explain the ground and any retention. Features needing withdrawn data may become unavailable. Signing out alone does not withdraw consent or delete records.`,
      'You can decline these terms before registration or sign out at first login. No acceptance box is preselected. Automated readings and configured alerts support human review; they must not be the sole basis for medical or other significant decisions.',
    ] },
    { title: '7. Responsible use and service limits', paragraphs: [
      'Provide accurate information, use only accounts and watches you are authorized to access, and respect the privacy of seniors and other users. Do not share credentials, track anyone without lawful authority, attempt to bypass access controls, upload unlawful content, or disclose records outside authorized care and safety purposes. Access may be reviewed, suspended or revoked for misuse, subject to applicable law.',
      'SafeWatch supports monitoring and coordination. Readings, GPS fixes, connectivity, battery status and alert delivery can be inaccurate, delayed or unavailable. It is not a medical diagnosis service or a guarantee of emergency response. For an emergency, seek help directly through your established emergency channels. These terms do not exclude duties or remedies that cannot lawfully be excluded.',
    ] },
    { title: '8. Acceptance and changes', paragraphs: [
      `The sign-up and first-login confirmations are separate steps. SafeWatch records your account identifier, application, notice version (${PRIVACY_TERMS_VERSION}), confirmation stage and server timestamp. It does not record your password in the acceptance receipt. First-login acceptance is remembered for your account across devices; it is not required at every login. Existing users without a receipt must review it at their next signed-in visit.`,
      'The operator must give notice before material changes to processing and obtain fresh consent where required. A new notice version requires another review. Philippine law governs these terms without limiting your statutory rights or access to the NPC and competent authorities.',
    ] },
  ];
}

export function signupPrivacyDeclaration(acceptance) {
  if (acceptance?.version !== PRIVACY_TERMS_VERSION || acceptance.terms !== true || acceptance.accountData !== true) {
    throw new Error('Review and accept the Terms and Conditions and account-data consent before signing up.');
  }
  return { privacy_terms_version: PRIVACY_TERMS_VERSION, privacy_terms_accepted: true, privacy_account_consent: true };
}

function checkApp(app) {
  if (!['family', 'dashboard'].includes(app)) throw new Error('Choose a supported application.');
}

function receiptMatches(receipt, userId, app) {
  return receipt?.user_id === userId && receipt.app === app && receipt.stage === 'first_login'
    && receipt.version === PRIVACY_TERMS_VERSION && typeof receipt.accepted_at === 'string'
    && Number.isFinite(Date.parse(receipt.accepted_at));
}

function privacyError(error) {
  if (['PGRST202', '42883', '42P01'].includes(error?.code)) {
    return new Error('Privacy acceptance needs to be configured by your administrator. Apply the SafeWatch privacy-terms migration, then try again.');
  }
  return error;
}

export async function loadPrivacyAcceptance(client, userId, app) {
  checkApp(app);
  const { data, error } = await client.rpc('get_safewatch_privacy_acceptance', { p_app: app, p_version: PRIVACY_TERMS_VERSION });
  if (error) throw privacyError(error);
  if (data === null) return null;
  if (!receiptMatches(data, userId, app)) throw new Error('Your privacy acceptance could not be verified. Please retry.');
  return data;
}

export async function acceptPrivacyTerms(client, userId, app, acceptance) {
  checkApp(app);
  signupPrivacyDeclaration(acceptance);
  await requireAccount(client, userId);
  const { data, error } = await client.rpc('accept_safewatch_privacy_terms', {
    p_app: app, p_version: PRIVACY_TERMS_VERSION, p_terms_accepted: true, p_account_consent: true,
  });
  if (error) throw privacyError(error);
  if (!receiptMatches(data, userId, app)) throw new Error('Your privacy acceptance could not be saved. Please retry.');
  // A switch/sign-out during the request must not unlock another account.
  await requireAccount(client, userId);
  return data;
}
