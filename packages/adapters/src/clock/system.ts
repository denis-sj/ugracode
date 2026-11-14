import type { ClockPort } from '@ugra/core';

/** Системные часы. */
export class SystemClock implements ClockPort {
  now(): Date {
    return new Date();
  }
}
