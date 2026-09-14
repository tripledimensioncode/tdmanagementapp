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
