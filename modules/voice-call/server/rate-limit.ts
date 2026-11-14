/** Скользящее окно: не больше `limit` событий за `windowMs` на ключ (адрес звонящего). */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  /** `true` — событие разрешено и учтено; `false` — лимит исчерпан, событие не учитывается. */
  take(key: string): boolean {
    const border = this.now() - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((at) => at > border);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(this.now());
    this.hits.set(key, recent);
    if (this.hits.size > 1000) this.prune(border);
    return true;
  }

  private prune(border: number): void {
    for (const [key, list] of this.hits) {
      if (list.every((at) => at <= border)) this.hits.delete(key);
    }
  }
}

/**
 * Адрес звонящего: Cloudflare-туннель кладёт `cf-connecting-ip`, прокси — `x-forwarded-for`.
 * Без заголовков (ноутбук, localhost) — общий ключ `local`.
 */
export function clientAddress(headers: Readonly<Record<string, string>> | undefined): string {
  const cf = headers?.['cf-connecting-ip']?.trim();
  if (cf) return cf;
  const forwarded = headers?.['x-forwarded-for']?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  return headers?.['x-real-ip']?.trim() || 'local';
}
