/**
 * Строковые утилиты без регулярных выражений.
 * Линейные по длине строки: заменяют шаблоны вида `/x+$/`, которые на длинном вводе
 * дают квадратичный откат (правило SonarQube S8786).
 */

/** Убирает с конца строки все символы из набора `chars`. */
export function trimEndChars(text: string, chars: string): string {
  let end = text.length;
  while (end > 0 && chars.includes(text.charAt(end - 1))) end -= 1;
  return text.slice(0, end);
}

/** Убирает с начала строки все символы из набора `chars`. */
export function trimStartChars(text: string, chars: string): string {
  let start = 0;
  while (start < text.length && chars.includes(text.charAt(start))) start += 1;
  return text.slice(start);
}

/** Убирает символы из набора `chars` с обоих концов строки. */
export function trimChars(text: string, chars: string): string {
  return trimEndChars(trimStartChars(text, chars), chars);
}

/** Делит строку цифр на группы по три с конца: `1234567` → `1 234 567` (разделитель задаётся). */
export function groupThousands(digits: string, separator: string): string {
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) {
    groups.unshift(digits.slice(Math.max(0, end - 3), end));
  }
  return groups.join(separator);
}
