import type { ClockPort } from '@ugra/core';

/** Фиксированные часы для тестов; каждый вызов отдаёт копию даты. */
export class FixedClock implements ClockPort {
  private readonly instant: Date;

  constructor(instant: Date | string | number = 0) {
    this.instant = new Date(instant);
  }

  now(): Date {
    return new Date(this.instant.getTime());
  }
}
