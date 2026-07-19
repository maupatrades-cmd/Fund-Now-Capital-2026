// South African data validation — single source of truth (SPEC "SA VALIDATION
// RULES", Roadmap B5). Format + checksum helpers shared by the lead, client, and
// contact forms. The DB stores raw text; these gate at entry. Framework-free so
// zod schemas, list filters, and detail views all share one implementation.
//
// Consolidates the validators that previously lived (and had drifted) in
// src/lib/leads.ts and src/lib/clients.ts.

// ---- CIPC company registration: YYYY/NNNNNN/NN --------------------------
export const CIPC_REGEX = /^\d{4}\/\d{6}\/\d{2}$/;

export function isValidCipc(raw: string): boolean {
  return CIPC_REGEX.test(raw.trim());
}

// ---- SA cell: 0 or +27 prefix, then 6/7/8, then 8 digits ----------------
// Spaces and dashes are ignored.
export const SA_CELL_REGEX = /^(?:\+?27|0)[678]\d{8}$/;

export function isValidSaCell(raw: string): boolean {
  return SA_CELL_REGEX.test(raw.replace(/[\s-]/g, ""));
}

// Normalise a valid SA cell to local 0XXXXXXXXX form for storage.
export function normaliseSaCell(raw: string): string {
  const digits = raw.replace(/[\s-]/g, "").replace(/^\+/, "");
  if (digits.startsWith("27")) return "0" + digits.slice(2);
  return digits;
}

// ---- VAT: 10 digits starting with 4 -------------------------------------
export const VAT_REGEX = /^4\d{9}$/;

export function isValidVatNumber(raw: string): boolean {
  return VAT_REGEX.test(raw.replace(/[\s-]/g, ""));
}

// ---- Postal code: 4 digits ----------------------------------------------
export const POSTAL_CODE_REGEX = /^\d{4}$/;

export function isValidPostalCode(raw: string): boolean {
  return POSTAL_CODE_REGEX.test(raw.trim());
}

// ---- SA ID: 13 digits, Luhn checksum, valid DOB + citizenship digit ------
// Structure: YYMMDD SSSS C A Z
//   YYMMDD  date of birth
//   SSSS     gender sequence (0000–4999 female, 5000–9999 male)
//   C        citizenship (0 = SA citizen, 1 = permanent resident)
//   A        historically a race digit — not validated
//   Z        Luhn check digit over the first 12 digits
export const SA_ID_REGEX = /^\d{13}$/;

// Luhn checksum over a numeric string (the last digit is the check digit).
function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48; // '0' === 48
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

export type SaIdParts = {
  dob: string; // ISO yyyy-mm-dd
  gender: "male" | "female";
  citizen: boolean; // true = SA citizen, false = permanent resident
};

// Parse + fully validate a 13-digit SA ID. Returns the derived parts on success,
// or null if structure / calendar date / citizenship digit / Luhn checksum fail.
export function parseSaId(raw: string): SaIdParts | null {
  const s = raw.replace(/[\s-]/g, "");
  if (!SA_ID_REGEX.test(s)) return null;

  const yy = Number(s.slice(0, 2));
  const mm = Number(s.slice(2, 4));
  const dd = Number(s.slice(4, 6));
  if (mm < 1 || mm > 12) return null;
  if (dd < 1 || dd > 31) return null;

  // Two-digit year → pick the century that can't put the birth date in the
  // future (a contact being 100+ is implausible for this CRM, so previous
  // century when 20YY would be future).
  const currentYear = new Date().getFullYear();
  const century = Math.floor(currentYear / 100) * 100;
  let year = century + yy;
  if (year > currentYear) year -= 100;

  // Round-trip through a real calendar date to reject impossible dates (e.g.
  // 30 February): the UTC date must echo back the same y/m/d.
  const dob = new Date(Date.UTC(year, mm - 1, dd));
  if (dob.getUTCFullYear() !== year || dob.getUTCMonth() !== mm - 1 || dob.getUTCDate() !== dd) {
    return null;
  }
  if (dob.getTime() > Date.now()) return null; // no future birth dates

  const citizenDigit = Number(s[10]);
  if (citizenDigit !== 0 && citizenDigit !== 1) return null;

  if (!luhnValid(s)) return null;

  const genderSeq = Number(s.slice(6, 10));
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    dob: `${year}-${pad(mm)}-${pad(dd)}`,
    gender: genderSeq >= 5000 ? "male" : "female",
    citizen: citizenDigit === 0,
  };
}

// Hard validity gate for zod refines. A failing Luhn/date/citizenship digit is a
// definitive typo, so forms block on false (B5 decision).
export function isValidSAIdNumber(raw: string): boolean {
  return parseSaId(raw) !== null;
}

// Human-readable derived summary for read-only helper text under an ID field,
// e.g. "DOB 1985-03-14 · Male · SA citizen". null when the ID isn't valid.
export function formatSaIdSummary(raw: string): string | null {
  const parts = parseSaId(raw);
  if (!parts) return null;
  const gender = parts.gender === "male" ? "Male" : "Female";
  const status = parts.citizen ? "SA citizen" : "Permanent resident";
  return `DOB ${parts.dob} · ${gender} · ${status}`;
}
