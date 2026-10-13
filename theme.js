/*
 * Theme: light, dark or high contrast. The choice lives in this browser only (localStorage), and the
 * default "System" follows the device. Loaded in the <head> without defer, so the page is painted in
 * its own theme. It also sets the browser bar colour and the tab icon, and builds the picker wherever
 * a page asks for one ([data-theme-picker], or MandoTheme.mount for a picker made by a script).
 */
(() => {
  'use strict';

  const KEY = 'mando.theme';
  const CHOICES = ['system', 'light', 'dark', 'contrast'];
  const LABELS = { system: 'System', light: 'Light', dark: 'Dark', contrast: 'Contrast' };
  // The browser bar colour and the tab icon of each theme (the icon's colours are the theme's tokens)
  const BAR = { light: '#ffffff', dark: '#121214', contrast: '#000000' };
  const ICON = {
    light: { tile: '#272727', letter: '#ffffff' },
    dark: { tile: '#f2f2f5', letter: '#121214' },
    contrast: { tile: '#ffffff', letter: '#000000' },
  };

  const root = document.documentElement;
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  const read = () => {
    try {
      const saved = localStorage.getItem(KEY);
      return CHOICES.includes(saved) ? saved : 'system';
    } catch {
      return 'system'; // storage can be blocked: the device decides
    }
  };
  const save = (choice) => {
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      // Blocked storage: the choice lasts for this page only
    }
  };
  const resolve = (choice) => (choice === 'system' ? (systemDark.matches ? 'dark' : 'light') : choice);

  const iconUrl = (theme) => {
    const { tile, letter } = ICON[theme];
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='${tile}'/><text x='16' y='23' font-size='20' font-weight='800' text-anchor='middle' fill='${letter}' font-family='Arial'>M</text></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  };

  const apply = (choice) => {
    const theme = resolve(choice);
    // "System" sets no attribute: the stylesheet's own media query then decides
    if (choice === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', choice);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR[theme]);
    document.querySelector('link[rel="icon"]')?.setAttribute('href', iconUrl(theme));
    document.querySelectorAll('.theme-picker button').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === choice));
    });
  };

  const set = (choice) => {
    save(choice);
    apply(choice);
  };

  // Builds a picker inside the element; the buttons say what they do and show the current choice
  const mount = (element) => {
    const group = document.createElement('div');
    group.className = 'theme-picker';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Theme');
    for (const choice of CHOICES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.themeChoice = choice;
      button.textContent = LABELS[choice];
      button.addEventListener('click', () => set(choice));
      group.append(button);
    }
    element.append(group);
    apply(read());
  };

  window.MandoTheme = { mount };
  apply(read());
  systemDark.addEventListener('change', () => apply(read()));

  const mountAll = () => document.querySelectorAll('[data-theme-picker]').forEach(mount);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll);
  else mountAll();
})();
