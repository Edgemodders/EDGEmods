// EDGEmods: small improvements on pages that work without JavaScript. Filters submit as they change, tabs and
// pictures switch in place, likes are sent without a reload. Nothing goes anywhere but this site.
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
        url.searchParams.delete('note');
        if (key === (tab.getAttribute('data-default') || 'about')) url.searchParams.delete('tab'); else url.searchParams.set('tab', key);
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

    // Likes: send the like form in place instead of reloading the page. Every button for the same mod follows.
    document.addEventListener('submit', function (e) {
      var form = e.target;
      if (!form.classList || !form.classList.contains('likeform') || !window.fetch) return;
      e.preventDefault();
      var button = form.querySelector('button');
      if (button) button.disabled = true;
      fetch(form.action, { method: 'POST', body: new URLSearchParams(new FormData(form)), headers: { accept: 'application/json' }, credentials: 'same-origin' })
        .then(function (res) { if (!res.ok) throw new Error(String(res.status)); return res.json(); })
        .then(function (r) {
          document.querySelectorAll('form.likeform[action="' + form.getAttribute('action') + '"]').forEach(function (f) {
            f.querySelector('input[name=like]').value = r.liked ? '0' : '1';
            var b = f.querySelector('button');
            b.setAttribute('aria-pressed', String(r.liked));
            b.title = r.liked ? 'Unlike' : 'Like';
            b.querySelector('.n').textContent = r.likes.toLocaleString('en');
            var w = b.querySelector('.w');
            if (w) w.textContent = r.liked ? 'Liked' : 'Like';
          });
        })
        .catch(function () { form.submit(); })
        .then(function () { if (button) button.disabled = false; });
    });

    // Times written in UTC by the server, shown in the reader's own time zone.
    document.querySelectorAll('time[data-local]').forEach(function (t) {
      var d = new Date(t.getAttribute('datetime'));
      if (!isNaN(d)) t.textContent = d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    });

    // A sign-in from VS Code: hand it to the editor straight away. The tab is not closed by script: closing it while
    // the browser asks "Open VS Code?" would drop the sign-in, so the page says it can be closed instead.
    var handoff = document.querySelector('a[data-handoff]');
    if (handoff) location.href = handoff.href;

    // The account menu closes when you click elsewhere or press Escape.
    var menu = document.querySelector('details.usermenu');
    if (menu) {
      document.addEventListener('click', function (e) { if (menu.open && !menu.contains(e.target)) menu.open = false; });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && menu.open) { menu.open = false; menu.querySelector('summary').focus(); } });
    }
  });
})();
