// Static markup input for siteFooterMarkup on the three lab pages that already
// offer these links. Kept out of the runtime footer graph on unrelated pages.
// tests/site-footer.test.js checks the authored pages against this generator.
export const LAB_SHIPLOG_ACTIONS = [
      '    <div class="hero-actions" id="ask-about-shiplog-actions">',
      '      <a class="text-link" id="ask-about-shiplog" href="#site-footer-panel" aria-describedby="ask-about-shiplog-description">Send a Shiplog follow-up request</a>',
      `      <p class="hint" id="ask-about-shiplog-description">Send a Shiplog follow-up request, and a person on the Wawalu team that operates it replies by email, usually within two working days.</p>`,
      '      <div class="hero-actions" id="ask-about-shiplog-intents">',
      '        <a class="text-link" id="ask-about-shiplog-demo" data-follow-up-intent="demo" href="#site-footer-intent-demo">Request a Shiplog demonstration</a>',
      '        <a class="text-link" id="ask-about-shiplog-pilot" data-follow-up-intent="pilot" href="#site-footer-intent-pilot">Discuss a Shiplog pilot</a>',
      '      </div>',
      '    </div>',
];
