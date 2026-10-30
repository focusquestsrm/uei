(function () {
  'use strict';

  const config = window.UEI_RUNTIME_CONFIG || {};
  const pixelId = config.metaPixelId;
  if (!pixelId) return;

  if (!window.fbq) {
    const fbq = function () { fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments); };
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = '2.0';
    fbq.queue = [];
    window._fbq = fbq;
    window.fbq = fbq;
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(script);
  }
  if (!window.__ueiMetaPageViewFired) {
    window.__ueiMetaPageViewFired = true;
    window.fbq('init', pixelId);
    window.fbq('track', 'PageView');
  }

  window.UEI_META = {
    // Callers decide when a Lead is legitimate; this only guards against firing twice.
    fireLead: function () {
      if (window.__ueiMetaLeadFired) return false;
      window.__ueiMetaLeadFired = true;
      window.fbq('track', 'Lead');
      return true;
    }
  };
})();
