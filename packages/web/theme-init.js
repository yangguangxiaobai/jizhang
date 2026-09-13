/*
 * Runs BEFORE the bundle, in the document head.
 *
 * Without this the page paints with the light values for as long as the bundle takes to
 * download and boot, which on a phone is a visible white flash before the dark theme
 * appears. Reading the stored preferences here and setting the attributes on <html> means
 * the very first paint is already correct.
 *
 * Kept dependency-free and tiny: it must not block first paint.
 *
 * `THEME_KEY`, `ACCENT_KEY` and the accepted values must match `composables/useTheme.ts`;
 * `scripts/check-color.mjs` fails the build if they drift.
 */
(function () {
  var THEME_KEY = 'jizhang.theme';
  var ACCENT_KEY = 'jizhang.accent';

  function read(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      // Private mode throws on access. Falling back to the defaults is the right answer
      // anyway, so there is nothing to report.
      return null;
    }
  }

  var theme = read(THEME_KEY);
  // Only `light` and `dark` are written as an attribute. Absence means "follow the system",
  // which the CSS media query handles — a third state cannot be expressed as an attribute
  // without also having to fight that query.
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  }

  var accent = read(ACCENT_KEY);
  // Likewise absence is the default preset (钛蓝); only the two alternatives are attributes.
  if (accent === 'forest' || accent === 'mono') {
    document.documentElement.setAttribute('data-accent', accent);
  }
})();
