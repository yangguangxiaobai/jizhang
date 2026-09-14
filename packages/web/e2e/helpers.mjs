import { expect } from '@playwright/test';

/** Shared measured layout contract for the iPhone and theme suites. */
export async function assertPhoneLayout(page) {
  const metrics = await page.evaluate(() => {
    const controls = [
      ...document.querySelectorAll('button, input, select, textarea, a[href], summary'),
    ];
    const small = [];
    const tinyFonts = [];
    for (const element of controls) {
      const target = element.matches('input[type=checkbox], input[type=radio]')
        ? (element.closest('label') ?? element)
        : element;
      const rect = target.getBoundingClientRect();
      if (!rect.width || !rect.height || getComputedStyle(target).visibility === 'hidden') continue;
      if (rect.width < 43.9 || rect.height < 43.9)
        small.push(
          `${element.tagName}:${element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 25)} ${rect.width}x${rect.height}`,
        );
      if (
        element.matches('input:not([type=checkbox]):not([type=radio]), select, textarea') &&
        parseFloat(getComputedStyle(element).fontSize) < 16
      )
        tinyFonts.push(element.outerHTML.slice(0, 100));
    }
    return { width: innerWidth, scroll: document.documentElement.scrollWidth, small, tinyFonts };
  });
  expect(metrics.scroll, 'No horizontal overflow').toBeLessThanOrEqual(metrics.width);
  expect(metrics.small, 'Every effective touch target is at least 44px').toEqual([]);
  expect(metrics.tinyFonts, 'Form fonts do not trigger iOS focus zoom').toEqual([]);
}
