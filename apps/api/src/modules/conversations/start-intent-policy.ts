/**
 * How long a prepared start intent may wait for its Runner start operation to
 * settle. Past this window the start cannot be correlated with a native turn;
 * the intent is released so the turn fails visibly instead of holding the
 * conversation slot and blocking maintenance forever.
 */
export const START_INTENT_UNSETTLED_RELEASE_MILLISECONDS = 15 * 60_000;
