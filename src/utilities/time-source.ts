export interface TimeSource {
  nowMilliseconds(): number;
  highResolutionNowMilliseconds(): number;
}

export const systemTimeSource: TimeSource = {
  nowMilliseconds: () => Date.now(),
  highResolutionNowMilliseconds: () => performance.now(),
};
