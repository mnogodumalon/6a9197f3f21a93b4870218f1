/**
 * src/lib/origin.ts — the ONE place a dashboard learns where Living Apps is.
 *
 * Same-origin contract: a dashboard is served by the LA host itself under
 * `{host}/objects/{appgroup}/`, and every backend it talks to (`/rest`,
 * `/litellm`, `/npm`, `/claude`, `/react-webcomponents`, `/actions-agent`)
 * sits on that same host. The origin is therefore a RUNTIME fact — the page's
 * own — never a build-time literal. A baked host broke staging: a bundle
 * copied over from production kept talking to production. Never spell a host
 * anywhere else in src/; derive every LA URL from LA_ORIGIN.
 *
 * `window.__LA_ORIGIN__` is an escape hatch for a deployment that serves the
 * bundle from somewhere other than the LA host (set it in index.html before
 * the module graph loads). Nothing sets it today.
 *
 * In the sandbox dev preview the origin is the Vite dev server; its proxy
 * forwards `/rest`, `/litellm`, `/npm` and `/react-webcomponents` to LA and
 * injects the API key, so this file needs no DEV branch.
 */
declare global {
  interface Window {
    __LA_ORIGIN__?: string;
  }
}

function resolveOrigin(): string {
  if (typeof window === 'undefined') return '';
  const override = window.__LA_ORIGIN__;
  if (typeof override === 'string' && override) return override.replace(/\/+$/, '');
  return window.location.origin;
}

/** Scheme + host of the Living Apps instance this dashboard runs on. No trailing slash. */
export const LA_ORIGIN: string = resolveOrigin();

/** Authenticated REST API (session cookie, `credentials: 'include'`). */
export const REST_URL = `${LA_ORIGIN}/rest`;

/** OpenAI-compatible chat completions behind the LA host. */
export const AI_ENDPOINT = `${LA_ORIGIN}/litellm/v1/chat/completions`;

/** IIFE build of heic-to, mirrored by the LA host (HEIC → JPEG fallback in lib/ai.ts). */
export const HEIC_TO_URL = `${LA_ORIGIN}/npm/heic-to/dist/iife/heic-to.js`;
