export const seniorName = senior => senior?.patient_name || senior?.name || 'Unnamed senior';
export function matchingSeniors(seniors, query = '') {
  const search = query.trim().toLocaleLowerCase();
  return seniors.filter(senior => seniorName(senior).toLocaleLowerCase().includes(search));
}
