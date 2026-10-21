// Native fragments remain usable without scripting and when opened in a new
// tab. The existing radios own selection and the footer owns submission.
export function initReleaseDiscussion(root = document, view = window) {
  const radios = [...root.querySelectorAll('input[name="intent"]')];
  const links = [...root.querySelectorAll('[data-release-discussion]')];
  let selecting = false;
  function select(hash) {
    const radio = radios.find((item) => `#${item.id}` === hash);
    if (!radio) return;
    if (root.querySelector('#site-footer-form')?.hidden) {
      root.querySelector('#site-footer-again')?.click();
    }
    for (const item of radios) item.checked = item === radio;
    selecting = true;
    radio.dispatchEvent(new view.Event('change', { bubbles: true }));
    selecting = false;
    radio.scrollIntoView?.({ block: 'center' });
    // The topic is answered; the email is what is left to fill (#2962).
    root.querySelector('#site-footer-email')?.focus({ preventScroll: true });
    return true;
  }
  const navigate = () => select(view.location.hash);
  for (const link of links) {
    link.addEventListener('click', (event) => {
      if (event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      // Also handles repeated activation of the current fragment.
      // A button names its topic in data-target: the page links each place once.
      const href = link.getAttribute('href');
      if (!select(href ?? link.dataset.target) || !href) return;
      // A browser focuses a focusable fragment target after this handler, which
      // would take focus back from the email field. Record the address instead,
      // so Back and sharing still work; modified clicks stay native.
      event.preventDefault();
      if (view.location.hash !== href) view.history.pushState(view.history.state, '', href);
    });
  }
  for (const radio of radios) {
    radio.addEventListener('change', () => {
      // Keep a manually revised choice shareable without adding history entries.
      if (!selecting && radios.some((item) => `#${item.id}` === view.location.hash)) {
        view.history.replaceState(view.history.state, '', `#${radio.id}`);
      }
    });
  }
  view.addEventListener('hashchange', navigate);
  navigate();
}
