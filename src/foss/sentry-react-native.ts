/**
 * FOSS build stand-in for `@sentry/react-native` (aliased by metro.config.js when `FOSS_BUILD=1`).
 *
 * The FOSS build sends no crash reports: it has no DSN, so `services/telemetry.ts` never starts
 * Sentry. These do nothing, so even a stray call cannot send anything.
 */
import type * as Sentry from '@sentry/react-native';

export const init: typeof Sentry.init = () => undefined;

export const captureException: typeof Sentry.captureException = () => '';

export const wrap: typeof Sentry.wrap = (component) => component;
