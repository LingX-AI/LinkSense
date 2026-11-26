import { searchPhoneNumbersInText } from "libphonenumber-js/max";
import { z } from "zod";

import type { PrivacyMaskingRuntime } from "../privacy-masking.js";

type PersonalKind = keyof NonNullable<PrivacyMaskingRuntime["personal_rules"]>;
type Match = { start: number; end: number };
export type PersonalDetector = (text: string, field?: string) => Iterable<Match>;

const emailPattern = /(?<![A-Za-z0-9_.+%@-])[A-Za-z0-9_+%~-][A-Za-z0-9_.+'%~-]{0,63}@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?(?![A-Za-z0-9_@-]|\.[A-Za-z0-9-])/gu;
const mainlandIdPattern = /(?<![A-Za-z0-9_])[1-9][0-9]{5}(?:18|19|20)[0-9]{2}[0-9]{7}[0-9Xx](?![A-Za-z0-9_])/gu;
const idWeights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const idCalendarDate = z.iso.date();
const cardLabel = String.raw`(?:\b(?:(?:(?:credit|debit|bank)[ _-]?card)(?:[ _-]?(?:number|no))?|card[ _-]?(?:number|no)|pan)\b\.?|(?:银行卡|信用卡|借记卡)(?:号码?)?|卡号|カード番号|número (?:de|da) (?:tarjeta|cartão)|numéro de carte)`;
const cardValue = String.raw`[0-9](?:[ \t-]?[0-9]){12,18}`;
const cardPattern = new RegExp(
  String.raw`${cardLabel}["']?[ \t]*[:：=]?[ \t]*["']?(${cardValue})(?![A-Za-z0-9_]|[ \t-][0-9])`,
  "gidu",
);
const cardFieldPattern = new RegExp(`^${cardLabel}$`, "iu");
const cardValuePattern = new RegExp(`^${cardValue}$`, "u");

function* emails(text: string): Iterable<Match> {
  if (!text.includes("@")) return;
  for (const match of text.matchAll(emailPattern)) {
    const value = match[0];
    const separator = value.indexOf("@");
    if (value.indexOf(".", separator) !== -1 && z.regexes.html5Email.test(value)) {
      yield { start: match.index, end: match.index + value.length };
    }
  }
}

function* mainlandIds(text: string): Iterable<Match> {
  for (const match of text.matchAll(mainlandIdPattern)) {
    const value = match[0];
    const checksum = idWeights.reduce(
      (sum, weight, index) => sum + weight * Number(value[index]),
      0,
    );
    if ("10X98765432"[checksum % 11] !== value.at(-1)?.toUpperCase()) continue;
    const birthDate = `${value.slice(6, 10)}-${value.slice(10, 12)}-${value.slice(12, 14)}`;
    if (idCalendarDate.safeParse(birthDate).success) {
      yield { start: match.index, end: match.index + value.length };
    }
  }
}

function validCardNumber(value: string): boolean {
  const digits = value.replace(/[^0-9]/gu, "");
  if (/^([0-9])\1+$/u.test(digits)) return false;
  let sum = 0;
  for (let index = digits.length - 1; index >= 0; index--) {
    let digit = Number(digits[index]);
    if ((digits.length - index) % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

function* bankCards(text: string, field?: string): Iterable<Match> {
  if (field !== undefined && cardFieldPattern.test(field) && cardValuePattern.test(text)) {
    if (validCardNumber(text)) yield { start: 0, end: text.length };
    return;
  }
  for (const match of text.matchAll(cardPattern)) {
    const range = match.indices?.[1];
    if (range && validCardNumber(text.slice(...range))) {
      yield { start: range[0], end: range[1] };
    }
  }
}

export function personalDetectors(
  phoneRegion: PrivacyMaskingRuntime["phone_region"],
): Record<PersonalKind, PersonalDetector> {
  return {
    EMAIL: emails,
    *PHONE(text) {
      if (!phoneRegion && !text.includes("+")) return;
      for (const { startsAt, endsAt } of searchPhoneNumbersInText(text, phoneRegion ?? undefined)) {
        if (phoneRegion || text[startsAt] === "+") yield { start: startsAt, end: endsAt };
      }
    },
    ID_CARD: mainlandIds,
    BANK_CARD: bankCards,
  };
}
