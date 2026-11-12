import type { Clock } from '../ports/clock';

/** 正式環境時鐘：回傳系統目前時間。 */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
