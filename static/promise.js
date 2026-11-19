// Printable promise card (RUNBOOK §6v, stocking fillers). Text only (textContent), nothing stored or sent.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  if (!$('pc-form')) return;
  function draw() {
    var o = $('pc-act').selectedOptions[0];
    $('pc-to-out').textContent = $('pc-to').value.trim() || 'you';
    $('pc-from-out').textContent = $('pc-from').value.trim() || 'me';
    var note = $('pc-note').value.trim();
    $('pc-title').textContent = o.dataset.title || note || 'Something worth doing, together';
    $('pc-note-out').textContent = o.dataset.title ? (note || 'Together, and soon.') : '';
    $('pc-url').textContent = o.dataset.url || 'dontdieretired.com';
  }
  ['pc-to', 'pc-from', 'pc-note', 'pc-act'].forEach(function (id) { $(id).addEventListener('input', draw); $(id).addEventListener('change', draw); });
  $('pc-print').addEventListener('click', function () {
    draw();
    try { if (window.plausible) plausible('promise_card', { props: { act: $('pc-act').value || 'own' } }); } catch (e) {}
    window.print();
  });
  draw();
})();
