/**
 * Shared job-status helpers.
 *
 * A single definition of "live" (i.e. still in flight) so the various
 * pollers / filters / banners across the app can't drift. Hoisted here
 * after iter 6 of the per-page progress milestone — previously each
 * caller redeclared its own Set / inline predicate and they were
 * starting to disagree (e.g. some included `scheduled`, some didn't).
 *
 * If you add a new in-flight status on the backend, update LIVE_STATUSES
 * here and every consumer picks it up automatically.
 */
export const LIVE_STATUSES: ReadonlySet<string> = new Set([
  "queued",
  "scheduled",
  "running",
]);

/** True when the job is still in flight (queued / scheduled / running). */
export function isLiveStatus(status: string): boolean {
  return LIVE_STATUSES.has(status);
}
