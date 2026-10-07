/*
 * Shared loader: the MANDO wordmark drawn by TechText, with one look for every page and moment.
 *
 *   Loader.show();  // fixed loader at the screen centre
 *   await Loader.hide();
 *   Loader.mount(slot); // into an existing slot (the home page title travels to the centre as one)
 *
 * The typography comes from the slot's CSS (font-size, font-weight, letter-spacing).
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

  const show = () => {
    if (instance) return;
    slot = document.createElement('div');
    slot.className = 'loader';
    slot.setAttribute('aria-hidden', 'true');
    document.body.append(slot);
    instance = mount(slot);
    slot.classList.add('is-visible');
  };

  const hide = async () => {
    if (!instance) return;
    const [oldSlot, oldInstance] = [slot, instance];
    slot = instance = null;
    oldSlot.classList.remove('is-visible');
    await new Promise((resolve) => setTimeout(resolve, FADE_MS));
    oldInstance.destroy();
    oldSlot.remove();
  };

  window.Loader = { mount, show, hide };
})();
