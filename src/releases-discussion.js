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
    radio.focus({ preventScroll: true });
    radio.scrollIntoView?.({ block: 'center' });
  }
  const navigate = () => select(view.location.hash);
  for (const link of links) {
    link.addEventListener('click', (event) => {
      if (event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      // Also handles repeated activation of the current fragment. Let the
      // browser perform navigation so Back and modified clicks stay native.
      select(link.getAttribute('href'));
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
