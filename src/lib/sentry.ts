import * as Sentry from '@sentry/react';

const DSN = "https://a0a6a937e751b39ecf7303042f45cd6e@sentry.livinglogic.de/42";
const ENVIRONMENT = "dashboard-6a9197f3f21a93b4870218f1";
/** The service version this bundle was built as — the SAME value that lands in
 *  the deployment's `version.json`. Exported so `lib/stale-bundle.ts` can tell a
 *  tab that is merely older than the live deployment apart from one whose asset
 *  is genuinely gone. One source for the fact; do not inject it a second time. */
export const BUNDLE_VERSION = "0.0.350";
const APPGROUP_ID = "6a9197f3f21a93b4870218f1";

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: ENVIRONMENT || undefined,
    release: BUNDLE_VERSION || undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    // Noise, not failure. React 19 hooks into the Navigation API and
    // intercepts its own transitions (`info === 'react-transition'`); the
    // browser runs a view transition for them. Reloading mid-flight, or
    // navigating again before one settles, aborts it — the promise rejects
    // with `AbortError: Transition was skipped`, React does not catch it, and
    // it arrives here as an unhandled rejection at level=error. Nothing broke
    // for the user: the navigation still happens, only the animation is
    // dropped. Switching between dashboard and CRUD pages produced a steady
    // stream of these until they were filtered.
    // Neither the message nor `startViewTransition` exists in our own code —
    // do not go looking for it there.
    ignoreErrors: ['Transition was skipped'],
  });
  if (APPGROUP_ID) {
    Sentry.setTag('appgroup_id', APPGROUP_ID);
  }
}

export { Sentry };
