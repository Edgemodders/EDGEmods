// EDGEmods: small improvements on pages that work without JavaScript. Filters submit as they change, tabs and
// pictures switch in place. Nothing is sent anywhere.
(function () {
  'use strict';
  document.documentElement.classList.add('js');

  document.addEventListener('DOMContentLoaded', function () {
    // Browse: the filters form submits itself; the Filters button opens it on small screens.
    var form = document.getElementById('browse');
    if (form) {
      form.addEventListener('change', function (e) {
        if (e.target.matches('input[type=checkbox], select')) {
          var page = form.querySelector('input[name=page]');
          if (page) page.remove();
          form.requestSubmit();
        }
      });
      var toggle = form.querySelector('.filters-toggle');
      var facets = document.getElementById('facets');
      if (toggle && facets) {
        toggle.addEventListener('click', function () {
          var open = facets.classList.toggle('open');
          toggle.setAttribute('aria-expanded', String(open));
        });
      }
    }

    // Mod page: tabs switch in place and keep the address, so a reload shows the same tab.
    var tabs = Array.prototype.slice.call(document.querySelectorAll('[data-tab]'));
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function (e) {
        e.preventDefault();
        var key = tab.getAttribute('data-tab');
        tabs.forEach(function (t) { t.setAttribute('aria-selected', String(t === tab)); });
        document.querySelectorAll('[data-panel]').forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== key; });
        var url = new URL(location.href);
        if (key === 'about') url.searchParams.delete('tab'); else url.searchParams.set('tab', key);
        history.replaceState(null, '', url.pathname + url.search);
      });
    });

    // Mod page: thumbnails show their picture in the main frame.
    var main = document.getElementById('galleryMain');
    var caption = document.getElementById('galleryCaption');
    document.querySelectorAll('[data-shot]').forEach(function (thumb) {
      thumb.addEventListener('click', function (e) {
        if (!main) return;
        e.preventDefault();
        main.src = thumb.getAttribute('data-shot');
        main.alt = thumb.getAttribute('data-caption') || '';
        if (caption) caption.textContent = thumb.getAttribute('data-caption') || '';
        document.querySelectorAll('[data-shot]').forEach(function (t) { t.setAttribute('aria-current', String(t === thumb)); });
      });
    });
  });
})();
