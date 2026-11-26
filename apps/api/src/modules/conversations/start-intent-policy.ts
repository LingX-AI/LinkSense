/**
 * How long a prepared start intent may wait for its Runner start operation to
 * settle. Past this window the start cannot be correlated with a native turn;
 * the intent is released so the turn fails visibly instead of holding the
 * conversation slot and blocking maintenance forever.
 */
export const START_INTENT_UNSETTLED_RELEASE_MILLISECONDS = 15 * 60_000;

/**
 * Total attempts for one durable start recovery job. Retained failures end the
 * batch instead of re-adding it with a fresh budget. With the queue's 5s
 * exponential backoff this spans roughly 42 minutes, covering the release
 * window even when the Runner operation was updated after its intent;
 * settlement notifications remain the fast path.
 */
export const START_RECOVERY_ATTEMPTS = 10;
