// ── Phone numbers typed by reps ──────────────────────────────────────────────
// Stored in HubSpot as E.164 (+31612345678), the format existing contacts
// already use and the one Aircall dials. Reps usually type the national form
// ("06 12 34 56 78"), so the country picker tells us which code to put in front.
// A number typed with + or 00 carries its own country and ignores the picker.

/** Countries in the picker. NL first: it's the default. */
export const PHONE_COUNTRIES = [
  { code: 'NL', dial: '31' },
  { code: 'BE', dial: '32' },
  { code: 'DE', dial: '49' },
  { code: 'LU', dial: '352' },
  { code: 'FR', dial: '33' },
  { code: 'GB', dial: '44' },
  { code: 'ES', dial: '34' },
] as const

export type PhoneCountry = typeof PHONE_COUNTRIES[number]['code']

/** The picker country a stored number belongs to, NL when it's none of them. */
export function phoneCountryOf(phone: string): PhoneCountry {
  const digits = phone.replace(/[^\d+]/g, '').replace(/^00/, '+')
  if (!digits.startsWith('+')) return 'NL'
  const hit = PHONE_COUNTRIES.find(c => digits.startsWith('+' + c.dial))
  return hit ? hit.code : 'NL'
}

/**
 * The typed number as E.164, or null when it isn't a valid number for that
 * country. libphonenumber-js is loaded only when a rep actually saves a number,
 * so it stays out of the main bundle.
 */
export async function normalizePhone(raw: string, country: PhoneCountry): Promise<string | null> {
  const cleaned = raw.trim()
    .replace(/\(0\)/g, '')   // "+31 (0)6 …" — the trunk 0 doesn't belong after the country code
    .replace(/^00/, '+')     // international prefix written out
  if (!cleaned) return null
  const { parsePhoneNumberFromString } = await import('libphonenumber-js/min')
  const parsed = parsePhoneNumberFromString(cleaned, country)
  return parsed && parsed.isValid() ? parsed.number : null
}
