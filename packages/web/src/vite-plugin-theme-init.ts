/**
 * Vite plugin: inlines `theme-init.js` into the built index.html's head.
 *
 * ## Why the script must be separate AND inlined
 *
 * Separate, because `check-pwa.mjs` reads the shipped HTML and asserts there is no
 * `user-scalable=no`; a blob buried inside a template literal would make that check
 * unreadable. Inlined, because it has to run before the bundle and before first paint —
 * otherwise the page paints light and snaps to dark, and on a phone that flash is
 * unmissable.
 *
 * The script lives at the package root rather than under `src` because it is not part of the
 * app bundle: it is a plain DOM script that must stay dependency-free, and keeping it out of
 * `src` makes that obvious. This plugin is the only thing that reads it.
 *
 * TypeScript rather than `.mjs` so `vue-tsc` can type it without an ambient module
 * declaration for a relative `.mjs` specifier, which this project's resolution mode does not
 * resolve.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const THEME_SCRIPT = readFileSync(join(here, '..', 'theme-init.js'), 'utf8');

const PLACEHOLDER = '<!--theme-init-->';

export function themeInitPlugin(): Plugin {
  return {
    name: 'jizhang-theme-init',
    transformIndexHtml: {
      // `pre` so the tag lands before the module script and before anything that paints.
      order: 'pre',
      handler(html: string): string {
        if (!html.includes(PLACEHOLDER)) {
          // Fail loudly rather than shipping a build that flashes white on every launch.
          throw new Error(
            `index.html is missing the ${PLACEHOLDER} placeholder needed to inline the theme script.`,
          );
        }
        return html.replace(PLACEHOLDER, `<script>\n${THEME_SCRIPT}\n    </script>`);
      },
    },
  };
}
