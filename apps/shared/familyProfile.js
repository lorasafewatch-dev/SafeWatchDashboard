const text = value => typeof value === 'string' ? value.trim() : '';

export function familyProfileFromUser(user) {
  const metadata = user?.user_metadata || {};
  const fullName = text(metadata.full_name) || text(metadata.name)
    || [metadata.first_name, metadata.middle_name, metadata.last_name].map(text).filter(Boolean).join(' ');
  // An explicitly empty contact number means the user cleared it.
  const phoneNumber = typeof metadata.phone_number === 'string' ? metadata.phone_number.trim()
    : text(metadata.contact_phone) || text(metadata.phone) || text(user?.phone);
  return { fullName, email: text(user?.email), phoneNumber, pendingEmail: text(user?.new_email) };
}

export function validateFamilyProfile(draft) {
  const fullName = text(draft.fullName).replace(/\s+/g, ' ');
  const email = text(draft.email).toLowerCase();
  const phoneNumber = text(draft.phoneNumber);
  if (!fullName || fullName.length > 100) throw new Error('Enter a full name of up to 100 characters.');
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter a valid email address.');
  }
  const digits = phoneNumber.replace(/\D/g, '');
  if (phoneNumber && (!/^\+?[0-9 ()\-.]+$/.test(phoneNumber) || digits.length < 7 || digits.length > 15)) {
    throw new Error('Enter a phone number with 7–15 digits, or leave it blank.');
  }
  return { fullName, email, phoneNumber };
}

export async function saveFamilyProfile(client, draft, { emailRedirectTo, expectedUserId } = {}) {
  const next = validateFamilyProfile(draft);
  const { data: currentData, error: readError } = await client.auth.getUser();
  if (readError) throw readError;
  const currentUser = currentData?.user;
  if (!currentUser) throw new Error('Please sign in again before saving your profile.');
  if (expectedUserId && currentUser.id !== expectedUserId) {
    throw new Error('Your signed-in account has changed. Reload your profile before saving.');
  }
  const current = familyProfileFromUser(currentUser);
  const changeEmail = next.email !== current.email.toLowerCase()
    && next.email !== current.pendingEmail.toLowerCase();
  if (!changeEmail && next.fullName === current.fullName && next.phoneNumber === current.phoneNumber) {
    return { user: currentUser, profile: current, changed: false };
  }
  // Supabase Auth persists these fields in auth.users.raw_user_meta_data.
  // The contact number is independent of phone-based sign-in and SMS OTP.
  const attributes = { data: { full_name: next.fullName, phone_number: next.phoneNumber } };
  if (changeEmail) attributes.email = next.email;
  const { data, error } = await client.auth.updateUser(attributes, { emailRedirectTo });
  if (error) throw error;
  if (!data?.user || data.user.id !== currentUser.id) {
    throw new Error('Your profile update could not be verified. Please reload and try again.');
  }
  const saved = familyProfileFromUser(data.user);
  if (saved.fullName !== next.fullName || saved.phoneNumber !== next.phoneNumber
      || (changeEmail && saved.email.toLowerCase() !== next.email && saved.pendingEmail.toLowerCase() !== next.email)) {
    throw new Error('Your profile update could not be verified. Please reload and check your details.');
  }
  return { user: data.user, profile: saved, changed: true };
}
