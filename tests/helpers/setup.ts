// Extends Vitest's expect with @testing-library/jest-dom matchers.
// Loaded globally via vitest.config.ts setupFiles so every test file gets them.
import "@testing-library/jest-dom/vitest";

// jsdom implements no layout, so Element.scrollIntoView does not exist. Any
// component that keeps a highlighted option in view — SearchableSelect, for
// one — throws on mount without this. Stubbing it here rather than per test
// file keeps that from ambushing the next component test.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
