// TRIPLE DIMENSION client JavaScript
console.log('TRIPLE DIMENSION intranet loaded');

document.addEventListener('DOMContentLoaded', function() {
  const navToggle = document.querySelector('[data-mobile-nav-toggle]');
  const navPanel = document.querySelector('[data-mobile-nav-panel]');

  if (navToggle && navPanel) {
    const setNavState = (open) => {
      navPanel.classList.toggle('hidden', !open);
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    };

    navToggle.addEventListener('click', function() {
      const isOpen = navToggle.getAttribute('aria-expanded') === 'true';
      setNavState(!isOpen);
    });

    window.addEventListener('resize', function() {
      if (window.innerWidth >= 1024) {
        setNavState(false);
      }
    });

    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') {
        setNavState(false);
      }
    });

    navPanel.querySelectorAll('a').forEach(function(link) {
      link.addEventListener('click', function() {
        setNavState(false);
      });
    });
  }
});

// ── Installable app (PWA) ────────────────────────────────────────────────────
// Registers the service worker and offers to install the app:
//  - Android / desktop Chrome & Edge: an "Install" button that opens the
//    browser's own install prompt.
//  - iPhone / iPad Safari: short instructions (Share → Add to Home Screen),
//    because iOS has no install prompt.
// Nothing is shown when already running as an installed app, and a dismissed
// banner stays hidden for 14 days on that device.
(function() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function(err) {
        console.warn('Service worker registration failed', err);
      });
    });
  }

  var DISMISS_KEY = 'td-install-dismissed-at';
  var DISMISS_DAYS = 14;

  var isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (isStandalone) return;

  function recentlyDismissed() {
    try {
      var at = Number(localStorage.getItem(DISMISS_KEY) || 0);
      return at && (Date.now() - at) < DISMISS_DAYS * 24 * 60 * 60 * 1000;
    } catch (e) {
      return false;
    }
  }

  function rememberDismiss() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (e) { /* ignore */ }
  }

  function showBanner(opts) {
    if (recentlyDismissed() || document.querySelector('.td-install')) return null;
    var el = document.createElement('div');
    el.className = 'td-install';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Install the TRIPLE DIMENSION app');

    var img = document.createElement('img');
    img.src = '/public/icons/icon-192.png';
    img.alt = '';
    el.appendChild(img);

    var text = document.createElement('div');
    text.className = 'td-install-text';
    var title = document.createElement('strong');
    title.textContent = 'Install the TD app';
    text.appendChild(title);
    text.appendChild(document.createTextNode(opts.message));
    el.appendChild(text);

    if (opts.onInstall) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'td-install-btn';
      btn.textContent = 'Install';
      btn.addEventListener('click', function() { opts.onInstall(el); });
      el.appendChild(btn);
    }

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'td-install-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    close.addEventListener('click', function() {
      rememberDismiss();
      el.remove();
    });
    el.appendChild(close);

    document.body.appendChild(el);
    return el;
  }

  // Android / Chrome / Edge
  window.addEventListener('beforeinstallprompt', function(event) {
    event.preventDefault();
    var deferred = event;
    showBanner({
      message: 'Open it from your home screen like any other app.',
      onInstall: function(el) {
        el.remove();
        deferred.prompt();
        deferred.userChoice.then(function(choice) {
          if (choice.outcome !== 'accepted') rememberDismiss();
        });
      }
    });
  });

  window.addEventListener('appinstalled', function() {
    var el = document.querySelector('.td-install');
    if (el) el.remove();
  });

  // iPhone / iPad Safari (iPadOS reports itself as a Mac with touch).
  var ua = window.navigator.userAgent;
  var isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  if (isIOS) {
    window.addEventListener('load', function() {
      showBanner({
        message: isSafari
          ? 'Tap the Share button, then "Add to Home Screen".'
          : 'Open this page in Safari, tap Share, then "Add to Home Screen".'
      });
    });
  }
})();
