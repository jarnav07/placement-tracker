export function normaliseRolePart(value = '') {
  return String(value ?? '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function roleIdentity(job) {
  const company = normaliseRolePart(job.company)
  const role = normaliseRolePart(job.title ?? job.specific_role)
  const city = normaliseRolePart(job.city ?? job.location)
  return `${company}|${role}|${city}`
}

export function sameRole(existing, placement) {
  return roleIdentity({
    company: existing.company,
    title: existing.specific_role,
    city: existing.city,
  }) === roleIdentity({
    company: placement.company,
    title: placement.specific_role,
    city: placement.city,
  })
}
