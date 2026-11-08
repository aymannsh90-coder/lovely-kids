/**
 * Only read-only GET requests may be replayed after a transient failure.
 * Never automatically replay checkout, payments, refunds, or other mutations.
 */
export const API_READ_MAX_ATTEMPTS = 3;

export function canRetryApiRead(
  method: string,
  attemptIndex: number,
  responseStatus?: number,
): boolean {
  if (method.toUpperCase() !== "GET" || attemptIndex >= API_READ_MAX_ATTEMPTS - 1) {
    return false;
  }

  // An omitted status is a transport/stream failure, never an HTTP error.
  return responseStatus === undefined || [502, 503, 504].includes(responseStatus);
}

export function apiReadRetryDelayMs(attemptIndex: number): number {
  // Small capped exponential backoff with jitter to avoid synchronized requests.
  return Math.min(1200, 350 * 2 ** Math.max(0, attemptIndex)) +
    Math.floor(Math.random() * 150);
}
