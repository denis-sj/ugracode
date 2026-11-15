/** Короткое отображение старого и нового номера заявки. */
export function shortTicketNumber(value: string): string {
  const trimmed = value.trim().replace(/^№\s*/, '');
  const match = /^(?:[Зз]-\d{8}-)?(\d+)$/.exec(trimmed);
  return match ? match[1]!.replace(/^0+(?=\d)/, '') : trimmed;
}
