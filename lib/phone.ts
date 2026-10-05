// ── Phone numbers typed by reps ──────────────────────────────────────────────
// Stored in HubSpot as E.164 (+31612345678), the format existing contacts
// already use and the one Aircall dials. Reps usually type the national form
// ("06 12 34 56 78"), so the country picker tells us which code to put in front.
// A number typed with + or 00 carries its own country and ignores the picker.
//
// libphonenumber-js is loaded only when a rep starts editing a phone number,
// so it stays out of the main bundle.
import type { CountryCode } from 'libphonenumber-js/min'

export type PhoneCountry = CountryCode

export interface PhoneCountryOption { code: PhoneCountry; dial: string; name: string }

/** Shown first in the picker: where most customers are. NL first: it's the default. */
export const PHONE_COUNTRIES_TOP: ReadonlyArray<{ code: PhoneCountry; dial: string }> = [
  { code: 'NL', dial: '31' },
  { code: 'BE', dial: '32' },
  { code: 'DE', dial: '49' },
  { code: 'LU', dial: '352' },
  { code: 'FR', dial: '33' },
  { code: 'GB', dial: '44' },
  { code: 'ES', dial: '34' },
]

let _lib: Promise<typeof import('libphonenumber-js/min')> | null = null
function lib() { return (_lib ??= import('libphonenumber-js/min')) }

const _lists = new Map<string, { top: PhoneCountryOption[]; rest: PhoneCountryOption[] }>()

/** Every country, named in the UI language: the top countries, then the rest A–Z. */
export async function loadPhoneCountries(lang: 'nl' | 'en'): Promise<{ top: PhoneCountryOption[]; rest: PhoneCountryOption[] }> {
  const cached = _lists.get(lang)
  if (cached) return cached
  const { getCountries, getCountryCallingCode } = await lib()
  let names: Intl.DisplayNames | null = null
  try { names = new Intl.DisplayNames([lang], { type: 'region' }) } catch { /* old browser: codes only */ }
  const option = (code: PhoneCountry): PhoneCountryOption => {
    let name: string = code
    try { name = names?.of(code) || code } catch { /* unknown region code */ }
    return { code, dial: getCountryCallingCode(code), name }
  }
  const topCodes = new Set<string>(PHONE_COUNTRIES_TOP.map(c => c.code))
  const list = {
    top: PHONE_COUNTRIES_TOP.map(c => option(c.code)),
    rest: getCountries().filter(c => !topCodes.has(c)).map(option)
      .sort((a, b) => a.name.localeCompare(b.name, lang)),
  }
  _lists.set(lang, list)
  return list
}

function e164ish(phone: string): string {
  return phone.replace(/[^\d+]/g, '').replace(/^00/, '+')
}

/** Quick guess without the library: a top country by prefix, else NL. */
export function phoneCountryOf(phone: string): PhoneCountry {
  const digits = e164ish(phone)
  if (!digits.startsWith('+')) return 'NL'
  const hit = PHONE_COUNTRIES_TOP.find(c => digits.startsWith('+' + c.dial))
  return hit ? hit.code : 'NL'
}

/**
 * The country a stored number belongs to. Top countries win on their prefix
 * (+44 is GB, not Guernsey); anything else is looked up in the library.
 */
export async function detectPhoneCountry(phone: string): Promise<PhoneCountry> {
  const digits = e164ish(phone)
  if (!digits.startsWith('+')) return 'NL'
  if (PHONE_COUNTRIES_TOP.some(c => digits.startsWith('+' + c.dial))) return phoneCountryOf(digits)
  const { parsePhoneNumberFromString } = await lib()
  return parsePhoneNumberFromString(digits)?.country || 'NL'
}

/** The typed number as E.164, or null when it isn't a valid number for that country. */
export async function normalizePhone(raw: string, country: PhoneCountry): Promise<string | null> {
  const cleaned = raw.trim()
    .replace(/\(0\)/g, '')   // "+31 (0)6 …" — the trunk 0 doesn't belong after the country code
    .replace(/^00/, '+')     // international prefix written out
  if (!cleaned) return null
  const { parsePhoneNumberFromString } = await lib()
  const parsed = parsePhoneNumberFromString(cleaned, country)
  return parsed && parsed.isValid() ? parsed.number : null
}
