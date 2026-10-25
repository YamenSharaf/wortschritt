/** Read-aloud can't be done with this voice now (not set up, unknown voice…). */
export class TtsUnavailable extends Error {}
/** The provider's limit is reached for now; `retryAfter` is when to try again (seconds), if it says. */
export class TtsRateLimited extends TtsUnavailable {
  constructor(
    message: string,
    public retryAfter: number | null,
  ) {
    super(message);
  }
}
