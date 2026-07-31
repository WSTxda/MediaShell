/**
 * @file scrollingLabel.js
 * @module shell.constants.scrollingLabel
 *
 * Defines Shell-side text-scroll cycle composition constants.
 *
 * ScrollingLabel imports these values to build equivalent repeated text cycles
 * without keeping presentation policy inside the runtime actor implementation.
 */

/** Separator inserted between equivalent copies of scrolling text. */
export const SCROLL_CYCLE_GAP = " ".repeat(5);

/** Number of text cycles rendered to keep animation endpoints away from scroll boundaries. */
export const SCROLL_CYCLE_COPIES = 3;
