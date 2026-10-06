/* Scam help page: country switch and the six questions for calls and doorstep visits.
   Nothing here is sent anywhere. The only thing stored is the reader's country choice, in this browser.

   THE RULES (fixed; same answers always give the same result). Sources are listed on the page under
   "About this page": Stop! Think Fraud (UK Government) on phone and doorstep fraud, and the FTC's
   "How to avoid a scam". Each question has a weight:
     blue    (it came out of the blue)                                   1
     rush    (pressing you to decide or act now)                         2
     details (wants money, bank or card details, a PIN, password, code)  3
     access  (wants remote access / wants to come inside)                3
     secret  (asks you to keep it secret, or not to tell bank/family)    DECISIVE
     pay     (move money to a "safe account", gift cards, crypto, cash)  DECISIVE
   Verdict:
     any DECISIVE yes, or total weight >= 5   -> "Treat this as a scam"
     total weight 1 to 4                      -> "Be suspicious: check before you do anything"
     total weight 0                           -> "No warning signs in your answers" (never "safe")
   Change the rules only with a source, and update this comment and the page together. */
(function () {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const track = (n, p) => { if (window.plausible) window.plausible(n, { props: p }); };
  const root = $('[data-scam]'); if (!root) return;

  // country: United States from the site's own time-zone check, United Kingdom from UK time zones, otherwise both
  let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
  const guess = document.body.dataset.region === 'us' ? 'us' : (/^Europe\/(London|Belfast|Jersey|Guernsey|Isle_of_Man)$/.test(tz) ? 'uk' : 'both');
  let saved = null; try { saved = localStorage.getItem('ddr_scam_region'); } catch (e) {}
  const sel = $('[data-scam-region]', root);
  const show = r => { $$('[data-reg]').forEach(d => d.hidden = !(r === 'both' || d.dataset.reg === r)); root.dataset.region = r; sel.value = r; render(); };
  sel.addEventListener('change', () => { try { localStorage.setItem('ddr_scam_region', sel.value); } catch (e) {} show(sel.value); });

  const Q = {
    call: [
      ['blue', 'Did the call come out of the blue?', 1],
      ['rush', 'Are they rushing you, or getting short with you when you ask questions?', 2],
      ['details', 'Do they want bank or card details, a PIN, a password, or a code sent to your phone?', 3],
      ['access', 'Do they want you to install something, or let them see or control your computer or phone?', 3],
      ['secret', 'Have they asked you to keep it secret, or not to tell your bank or family?', 'x'],
      ['pay', 'Have they asked you to move money to a "safe account", or to pay by bank transfer, gift cards or cryptocurrency?', 'x'],
    ],
    doorstep: [
      ['blue', 'Did they turn up without you asking them to come?', 1],
      ['rush', 'Are they pressing you to decide now, or offering a price "for today only"?', 2],
      ['details', 'Do they want money, bank or card details before any work is done or goods handed over?', 3],
      ['access', 'Have they no ID you can check, or did they turn defensive when you asked questions?', 3],
      ['secret', 'Have they asked you not to talk to anyone else first?', 'x'],
      ['pay', 'Do they want cash now, or have they offered to take you to the bank or a cash machine?', 'x'],
    ],
  };
  const WHY = {
    blue: 'It came out of the blue.', rush: 'You are being rushed.', details: 'They want money or security details.',
    access: { call: 'They want access to your device.', doorstep: 'You cannot confirm who they are.' },
    secret: 'They asked for secrecy.', pay: 'They want payment in a way that cannot be undone.',
  };
  const NEXT = {
    call: {
      uk: 'Hang up. Wait a few minutes, then ring the organisation on a number you already trust. For your bank, you can dial 159.',
      us: 'Hang up. Wait a few minutes, then ring the organisation on a number you already trust, such as the one on your card or a bill.',
    },
    doorstep: {
      uk: 'Say "no thanks" and close the door. Do not hand over money, cards or details. Ask a neighbour or friend if they know the firm, and check it using contact details you find yourself.',
      us: 'Say "no thanks" and close the door. Do not hand over money, cards or details. Ask a neighbor or friend if they know the company, and check it using contact details you find yourself.',
    },
  };
  const state = { call: {}, doorstep: {} };

  function verdict(type) {
    const a = state[type], qs = Q[type];
    if (qs.some(q => a[q[0]] === undefined)) return null;
    let score = 0, decisive = false; const why = [];
    qs.forEach(([id, , w]) => { if (a[id]) { if (w === 'x') decisive = true; else score += w; why.push(typeof WHY[id] === 'string' ? WHY[id] : WHY[id][type]); } });
    const level = (decisive || score >= 5) ? 'scam' : (score > 0 ? 'suspicious' : 'clear');
    return { level, why };
  }
  function render() {
    $$('[data-quiz]').forEach(box => {
      const type = box.dataset.quiz, a = state[type], reg = root.dataset.region || 'both';
      const qs = Q[type].map(([id, text]) => `<fieldset class="scam-q"><legend>${text}</legend><div class="chips">
        <button type="button" class="chip" data-q="${id}" data-v="1" aria-pressed="${a[id] === true}">Yes</button>
        <button type="button" class="chip" data-q="${id}" data-v="0" aria-pressed="${a[id] === false}">No</button></div></fieldset>`).join('');
      const v = verdict(type); let res = '';
      if (v) {
        const head = { scam: 'Treat this as a scam.', suspicious: 'Be suspicious: check before you do anything.', clear: 'No warning signs in your answers.' }[v.level];
        const lead = v.level === 'clear' ? 'That is not proof it is genuine. If money or personal details come into it later, stop and check.' : 'What gave it away: ' + v.why.join(' ');
        const next = (reg === 'both' ? ['uk', 'us'] : [reg]).map(r => `<p>${reg === 'both' ? '<strong>' + (r === 'uk' ? 'UK' : 'US') + ':</strong> ' : ''}${NEXT[type][r]}</p>`).join('');
        res = `<div class="scam-verdict scam-${v.level}" role="status"><h3>${head}</h3><p>${lead}</p>${v.level === 'clear' ? '' : next}<button type="button" class="linklike" data-reset>Start again</button></div>`;
      }
      box.innerHTML = qs + res;
    });
  }
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-q]'), r = e.target.closest('[data-reset]');
    const box = e.target.closest('[data-quiz]'); if (!box) return;
    const type = box.dataset.quiz;
    if (r) { state[type] = {}; render(); return; }
    if (!b) return;
    const before = verdict(type);
    state[type][b.dataset.q] = b.dataset.v === '1'; render();
    const v = verdict(type); if (v && !before) track('scam_quiz', { type, result: v.level });
    const fresh = box.querySelector(`[data-q="${b.dataset.q}"][data-v="${b.dataset.v}"]`); if (fresh) fresh.focus();
  });
  $$('.scam-type').forEach(d => d.addEventListener('toggle', () => { if (d.open) track('scam_type', { type: d.dataset.type }); }));
  $$('[data-scam-tool]').forEach(a => a.addEventListener('click', () => track('scam_tool', { tool: a.dataset.scamTool })));
  show(saved || guess);
  if (location.hash) { const d = $('.scam-type[data-type="' + location.hash.slice(1) + '"]'); if (d) d.open = true; }
})();
