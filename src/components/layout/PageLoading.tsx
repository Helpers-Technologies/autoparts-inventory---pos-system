import { AppBootScreen } from "./AppBootScreen";

/**
 * Route/suspense fallback.
 *
 * This returned null, with the note "so no spinners/dialogs ever flash". The
 * intent was right and is kept — AppBootScreen draws nothing for the first
 * quarter-second — but on a shop with years of history the wait is measured in
 * seconds, and for all of it the window was blank white, which is what a
 * crashed app looks like.
 */
export function PageLoading() {
  return <AppBootScreen />;
}
