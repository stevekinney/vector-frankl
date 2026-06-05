import type { TimeSource } from '../../utilities/time-source.js';

export class DeterministicClock implements TimeSource {
  private nowValueMilliseconds: number;
  private highResolutionNowValueMilliseconds: number;

  constructor(startMilliseconds = 1_700_000_000_000) {
    this.nowValueMilliseconds = startMilliseconds;
    this.highResolutionNowValueMilliseconds = 0;
  }

  nowMilliseconds(): number {
    return this.nowValueMilliseconds;
  }

  highResolutionNowMilliseconds(): number {
    return this.highResolutionNowValueMilliseconds;
  }

  advanceBy(milliseconds: number): void {
    this.nowValueMilliseconds += milliseconds;
    this.highResolutionNowValueMilliseconds += milliseconds;
  }

  set(milliseconds: number): void {
    this.nowValueMilliseconds = milliseconds;
    this.highResolutionNowValueMilliseconds = 0;
  }
}
