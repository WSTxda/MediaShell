/**
 * @file helpers.mjs
 * @module tests.helpers
 *
 * Provides compact named-case execution for consolidated contract tests.
 * Consolidated suites keep matrix failures specific without creating subtests.
 */

/** Runs named cases sequentially and preserves the failing case in diagnostics. */
export async function runCases(cases) {
  for (const [label, callback] of cases) {
    try {
      await callback();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`[${label}] ${detail}`, { cause: error });
    }
  }
}
