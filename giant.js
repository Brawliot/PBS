/*
 * Giant wordmark (plan page): duplicates the group so the loop is seamless, then starts the animation.
 * Kept in its own file so the page needs no inline script (see the Content-Security-Policy).
 */
(() => {
  'use strict';
  const track = document.querySelector('.giant__track');
  const copy = track.firstElementChild.cloneNode(true);
  copy.setAttribute('aria-hidden', 'true');
  track.append(copy);
  track.classList.add('is-looping');
})();
