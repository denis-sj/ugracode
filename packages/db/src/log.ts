/** Вывод CLI-команд без `console` (SonarQube считает console.log замечанием). */
export function log(...parts: unknown[]): void {
  process.stdout.write(`${parts.map((part) => String(part)).join(' ')}\n`);
}
