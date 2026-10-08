/*
 * Shared loader: the MANDO wordmark drawn by TechText, with one look for every page and moment.
 *
 *   Loader.show();  // fixed loader at the screen centre
 *   await Loader.hide();
 *   Loader.mount(slot); // into an existing slot (the home page title travels to the centre as one)
 *
 * The typography comes from the slot's CSS (font-size, font-weight, letter-spacing).
 * A loader that is fading out after hide() is removed at once when show() is called, so two never overlap.
 */
(() => {
  const TEXT = 'MANDO';
  const FADE_MS = 400; // keep in sync with .loader in styles.css

  const options = (slot) => {
    const style = getComputedStyle(slot);
    const size = parseFloat(style.fontSize);
    return {
      text: TEXT,
      fontWeight: Number(style.fontWeight),
      fontSize: size,
      letterSpacing: parseFloat(style.letterSpacing) / size,
      reveal: 'letter',
      dashLength: 4,
      dashGap: 2,
      specks: 15,
      color: '#000000',
      accentColor: '#272727',
    };
  };

  const mount = (slot) => window.createTechText(slot, options(slot));

  let slot = null;
  let instance = null;
  // The loader that hide() is fading out: { slot, instance, timer, resolve }. At most one at a time.
  let fading = null;

  /** Removes the fading loader now: its timer is cancelled and the hide() that started it resolves */
  const retire = () => {
    if (!fading) return;
    const current = fading;
    fading = null;
    clearTimeout(current.timer);
    current.instance.destroy();
    current.slot.remove();
    current.resolve();
  };

  const show = () => {
    if (instance) return;
    retire();
    slot = document.createElement('div');
    slot.className = 'loader';
    slot.setAttribute('aria-hidden', 'true');
    document.body.append(slot);
    instance = mount(slot);
    slot.classList.add('is-visible');
  };

  const hide = () => {
    if (!instance) return Promise.resolve();
    const [oldSlot, oldInstance] = [slot, instance];
    slot = instance = null;
    oldSlot.classList.remove('is-visible');
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (fading?.slot === oldSlot) fading = null;
        oldInstance.destroy();
        oldSlot.remove();
        resolve();
      }, FADE_MS);
      fading = { slot: oldSlot, instance: oldInstance, timer, resolve };
    });
  };

  window.Loader = { mount, show, hide };
})();
