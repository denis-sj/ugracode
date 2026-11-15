/** Числа словами для озвучки: «З-20261114-0602» модель должна прочитать «шестьсот два». */

const UNITS = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'] as const;
const FEMININE_UNITS = ['ноль', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'] as const;
const TEENS = [
  'десять',
  'одиннадцать',
  'двенадцать',
  'тринадцать',
  'четырнадцать',
  'пятнадцать',
  'шестнадцать',
  'семнадцать',
  'восемнадцать',
  'девятнадцать',
] as const;
const TENS = [
  '',
  '',
  'двадцать',
  'тридцать',
  'сорок',
  'пятьдесят',
  'шестьдесят',
  'семьдесят',
  'восемьдесят',
  'девяносто',
] as const;
const HUNDREDS = [
  '',
  'сто',
  'двести',
  'триста',
  'четыреста',
  'пятьсот',
  'шестьсот',
  'семьсот',
  'восемьсот',
  'девятьсот',
] as const;

/** Максимальное число, которое произносим словами; дальше — по цифрам. */
export const MAX_SPOKEN_NUMBER = 9999;

/** «тысяча», «две тысячи», «пять тысяч». */
function thousandsWord(count: number): string {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return 'тысяч';
  const last = count % 10;
  if (last === 1) return 'тысяча';
  if (last >= 2 && last <= 4) return 'тысячи';
  return 'тысяч';
}

/** 1..999 словами; `feminine` — для тысяч («одна тысяча»). */
function underThousand(value: number, feminine = false): string {
  const parts: string[] = [];
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  if (hundreds > 0) parts.push(HUNDREDS[hundreds] ?? '');
  if (rest >= 10 && rest < 20) {
    parts.push(TEENS[rest - 10] ?? '');
  } else {
    const tens = Math.floor(rest / 10);
    if (tens > 0) parts.push(TENS[tens] ?? '');
    const unit = rest % 10;
    if (unit > 0) parts.push((feminine ? FEMININE_UNITS[unit] : UNITS[unit]) ?? '');
  }
  return parts.filter((part) => part !== '').join(' ');
}

/**
 * Целое число 0..9999 словами: 602 → «шестьсот два», 1201 → «тысяча двести один».
 * Вне диапазона — исключение: вызывающий сам решает, как читать (см. `ticketNumberWords`).
 */
export function numberToWords(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > MAX_SPOKEN_NUMBER) {
    throw new RangeError(`Число ${value} вне диапазона 0..${MAX_SPOKEN_NUMBER}`);
  }
  if (value === 0) return 'ноль';
  const thousands = Math.floor(value / 1000);
  const rest = value % 1000;
  const parts: string[] = [];
  if (thousands > 0) {
    parts.push(thousands === 1 ? 'тысяча' : `${underThousand(thousands, true)} ${thousandsWord(thousands)}`);
  }
  if (rest > 0) parts.push(underThousand(rest));
  return parts.join(' ');
}

/** Длинное число или код читаем по цифрам: «два ноль два шесть». */
export function digitsToWords(value: string): string {
  return [...value]
    .map((symbol) => UNITS[Number(symbol)] ?? symbol)
    .filter((word) => word !== '')
    .join(' ');
}

/**
 * Номер заявки для озвучки по последней группе цифр:
 * «З-20261114-0602» и «№ 602» → «шестьсот два»; вне 0..9999 или без цифр — по цифрам.
 */
export function ticketNumberWords(numberOrId: string): string {
  const text = numberOrId.trim();
  const groups = text.match(/\d+/g);
  const last = groups?.[groups.length - 1];
  if (last === undefined) return text;
  const value = Number.parseInt(last, 10);
  if (Number.isSafeInteger(value) && value >= 0 && value <= MAX_SPOKEN_NUMBER) return numberToWords(value);
  return digitsToWords(last);
}
