import { describe, expect, it } from 'vitest';
import { FixedClock, SystemClock } from '@ugra/adapters';

describe('FixedClock', () => {
  it('возвращает фиксированное время', () => {
    const clock = new FixedClock('2026-11-14T10:00:00.000Z');

    expect(clock.now().toISOString()).toBe('2026-11-14T10:00:00.000Z');
  });

  it('не отдаёт одну и ту же ссылку на Date', () => {
    const clock = new FixedClock(0);
    const first = clock.now();
    first.setFullYear(2000);

    expect(clock.now().getTime()).toBe(0);
  });
});

describe('SystemClock', () => {
  it('возвращает текущее время', () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();

    expect(now).toBeGreaterThanOrEqual(before);
  });
});
