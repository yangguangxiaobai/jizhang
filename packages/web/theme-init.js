/*
 * Runs BEFORE the bundle, in the document head.
 *
 * Without this the page paints with the light values for as long as the bundle takes to
 * download and boot, which on a phone is a visible white flash before the dark theme
 * appears. Reading the stored preference here and setting the attribute on <html> means the
 * very first paint is already correct.
 *
 * Kept dependency-free and tiny: it must not block first paint.
 *
 * `THEME_KEY` must match `composables/useTheme.ts`.
 */
(function () {
  var THEME_KEY = 'jizhang.theme';
  var stored = null;
  try {
    stored = window.localStorage.getItem(THEME_KEY);
  } catch (error) {
    // Private mode throws on access. Falling back to "follow the system" is the right
    // default anyway, so there is nothing to report.
    stored = null;
  }

  // Only `light` and `dark` are written as an attribute. Absence means "follow the system",
  // which the CSS media query handles — a third state cannot be expressed as an attribute
  // without also having to fight that query.
  if (stored === 'light' || stored === 'dark') {
    document.documentElement.setAttribute('data-theme', stored);
  }
})();
