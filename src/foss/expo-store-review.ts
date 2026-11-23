/**
 * FOSS build stand-in for `expo-store-review` (aliased by metro.config.js when `FOSS_BUILD=1`).
 *
 * The real module asks Google Play for its in-app review sheet, which is a Google library. Here the
 * sheet is never available, so `services/review.ts` never prompts. The "Rate the app" rows are hidden
 * in this build too (`isFossBuild()`): the FOSS build shows no store links (owner, 2026-11-23).
 */
import type * as StoreReview from 'expo-store-review';

export const isAvailableAsync: typeof StoreReview.isAvailableAsync = async () => false;

export const requestReview: typeof StoreReview.requestReview = async () => {
  throw new Error('In-app review is not part of this build');
};
