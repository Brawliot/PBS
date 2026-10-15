/*
 * Theme: light or dark, following the device. Loaded in the <head> without defer, so the page is painted in
 * its own theme. The stylesheet's media query sets the colours; this file sets the browser bar colour and
 * the tab icon to match, and follows the device when it changes.
 */
(() => {
  'use strict';

  // The browser bar colour and the tab icon of each theme (the icon's colours are the theme's tokens)
  const BAR = { light: '#f6f7f8', dark: '#0b0c0f' };
  const ICON = {
    light: { tile: '#0b0c0f', letter: '#c6f36b' },
    dark: { tile: '#c6f36b', letter: '#0b0c0f' },
  };

  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  const iconUrl = (theme) => {
    const { tile, letter } = ICON[theme];
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='${tile}'/><text x='16' y='23' font-size='20' font-weight='800' text-anchor='middle' fill='${letter}' font-family='Arial'>M</text></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  };

  const apply = () => {
    const theme = systemDark.matches ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR[theme]);
    document.querySelector('link[rel="icon"]')?.setAttribute('href', iconUrl(theme));
  };

  apply();
  systemDark.addEventListener('change', apply);
})();
