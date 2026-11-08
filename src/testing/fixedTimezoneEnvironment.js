/**
 * A Jest environment that pins the process timezone for one test file.
 *
 * Why this exists, rather than `process.env.TZ = '…'` in a `beforeAll`:
 *
 * Jest hands each test file a sandboxed `process` object whose `env` is a plain copy of the real
 * one. Node changes the timezone through a *native setter* on the real `process.env` — assigning
 * `TZ` on the copy sets a string and nothing else. `Date` and `Intl` keep the zone the process
 * started in, so the pin silently does nothing and the suite quietly measures the machine's
 * timezone instead of the one it claims. Tests that pin "00:30 local, Fajr at 04:34" then pass or
 * fail depending on where CI happens to be standing.
 *
 * A test environment is loaded in Node's own realm, before the sandbox runs a line of the test
 * file, so `process.env` here is the real object with the real setter. Writing to it fires V8's
 * date-configuration change notification, which clears the cached zone for the whole isolate —
 * the sandbox's `Date` included.
 *
 * Usage, in the test file's *first* docblock:
 *
 *   @jest-environment <rootDir>/src/testing/fixedTimezoneEnvironment.js
 *   @jest-environment-options {"timezone": "Europe/Istanbul"}
 *
 * The previous value is restored on teardown, because a worker runs many test files in the same
 * process and the next one is entitled to the timezone it was launched with.
 */

'use strict';

const ReactNativeEnv = require('@react-native/jest-preset/jest/react-native-env');

/** Force V8/ICU to re-read `TZ`. Assigning to the real `process.env` is what triggers it. */
function adoptTimezone(timezone) {
  if (timezone === undefined) delete process.env.TZ;
  else process.env.TZ = timezone;
}

module.exports = class FixedTimezoneEnvironment extends ReactNativeEnv {
  constructor(config, context) {
    super(config, context);

    const { timezone } = config.projectConfig.testEnvironmentOptions ?? {};
    if (typeof timezone !== 'string' || timezone.length === 0) {
      throw new Error(
        'fixedTimezoneEnvironment requires @jest-environment-options {"timezone": "Area/City"}'
      );
    }

    this.previousTimezone = process.env.TZ;
    adoptTimezone(timezone);

    // Fail loudly rather than let a typo'd zone fall back to UTC and rot a fixture silently.
    const resolved = new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    if (resolved.resolvedOptions().timeZone !== timezone) {
      adoptTimezone(this.previousTimezone);
      throw new Error(`fixedTimezoneEnvironment: unknown timezone "${timezone}"`);
    }
  }

  async teardown() {
    adoptTimezone(this.previousTimezone);
    await super.teardown();
  }
};
