/*
 * Giant wordmark, the one place that builds it for every page: an empty <div class="giant"> is filled with two
 * rows of MANDO. The first scrolls right; the second is flipped upside down, has the colours swapped and
 * scrolls left. Each row holds its group twice so the loop is seamless.
 * Kept in its own file so the pages need no inline script (see the Content-Security-Policy).
 */
(() => {
  'use strict';
  const WORD = 'MANDO';
  const GRAY = new Set([0, 2]); // M and N in the first row; the second row swaps them

  const giant = document.querySelector('.giant');
  if (!giant) return;

  const row = (flipped) => {
    const group = document.createElement('div');
    group.className = 'giant__group';
    [...WORD].forEach((char, i) => {
      const letter = document.createElement('span');
      letter.className = 'giant__letter';
      if (GRAY.has(i) !== flipped) letter.classList.add('giant__letter--gray');
      letter.textContent = char;
      group.append(letter);
    });
    const track = document.createElement('div');
    track.className = 'giant__track is-looping';
    track.append(group, group.cloneNode(true));
    const wrap = document.createElement('div');
    wrap.className = flipped ? 'giant__row giant__row--flipped' : 'giant__row';
    wrap.append(track);
    return wrap;
  };

  giant.replaceChildren(row(false), row(true));
})();
