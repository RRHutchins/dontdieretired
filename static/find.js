/* Search words (Robin, 13 Nov 2026: "I searched for pottery and nothing came up").
   One matcher for the Things to do search and the site search. Each word the reader types is widened to its stem
   ("painting" → "paint", "swimming" → "swim") and to a few plain synonyms ("pottery" also finds ceramics and clay),
   and every word must match somewhere. score() ranks title hits above body hits. Nothing leaves the browser. */
(function (root) {
  // groups of words that mean the same thing to a reader; a typed word that starts with any member finds them all
  const GROUPS = [
    ['pottery', 'potter', 'ceramic', 'clay', 'raku'],
    ['paint', 'watercolour', 'watercolor', 'acrylic', 'oil painting'],
    ['draw', 'sketch', 'illustrat'],
    ['swim', 'open water', 'wild swim', 'lido'],
    ['walk', 'hike', 'hiking', 'trail', 'ramble', 'trek'],
    ['run', 'jog', 'parkrun', 'marathon'],
    ['cycl', 'bike', 'biking', 'bicycle'],
    ['boat', 'sail', 'yacht', 'canoe', 'kayak', 'paddle'],
    ['music', 'instrument', 'sing', 'choir', 'band'],
    ['dance', 'dancing', 'ballroom', 'salsa', 'tango'],
    ['write', 'writing', 'novel', 'poem', 'poetry', 'memoir'],
    ['craft', 'handmade'],
    ['volunteer', 'charity'],
    ['garden', 'grow', 'allotment', 'plant'],
    ['cook', 'bake', 'baking', 'chef', 'food'],
    ['star', 'stargaz', 'astronom', 'telescope', 'night sky', 'planet', 'meteor', 'aurora'],
    ['bird', 'wildlife', 'nature', 'animal'],
    ['fish', 'angling', 'angler'],
    ['wood', 'carpent', 'joinery', 'carv'],
    ['photo', 'camera'],
    ['money', 'pension', 'finance', 'budget'],
    ['job', 'career', 'earn', 'part-time'],
    ['computer', 'tech', 'online', 'internet', 'phone'],
    ['ai', 'artificial intelligence', 'chatgpt', 'claude'],
    ['fit', 'exercise', 'gym', 'strength', 'workout'],
  ];
  const STOP = new Set(['a', 'an', 'the', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'with', 'how', 'do', 'i', 'my', 'me', 'near', 'class', 'classes', 'course', 'courses', 'lesson', 'lessons', 'learn', 'learning', 'try', 'beginner', 'beginners', 'uk', 'us', 'usa']);
  function stem(w) {
    let s = w;
    if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
    else if (s.length > 4 && s.endsWith('ers')) s = s.slice(0, -3);
    else if (s.length > 4 && s.endsWith('ies')) s = s.slice(0, -3) + 'y';
    else if (s.length > 4 && s.endsWith('es') && /(ch|sh|ss|x)es$/.test(s)) s = s.slice(0, -2);
    else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
    if (s.length > 3 && /([bdgmnprt])\1$/.test(s)) s = s.slice(0, -1);   // swimm → swim, runn → run
    return s;
  }
  // one typed word → the strings any of which counts as a match
  function forms(w) {
    const st = stem(w), out = new Set([w, st]);   // order matters: score() treats the first two as the reader's own word
    // short members ("ai", "run", "star") join only on an exact word, so "aikido" and "start" stay themselves
    const joins = m => m.length <= 4 ? (w === m || st === m) : (w.startsWith(m) || st.startsWith(m) || (st.length > 4 && m.startsWith(st)));
    for (const g of GROUPS) if (g.some(joins)) g.forEach(m => out.add(m));
    const a = [...out]; if (a.length === 1 || a[1] !== st) a.splice(1, 0, st);
    return a;
  }
  function words(q) {
    const all = String(q || '').toLowerCase().replace(/[^a-z0-9' -]/g, ' ').split(/\s+/).filter(Boolean);
    const kept = all.filter(w => !STOP.has(w));
    return (kept.length ? kept : all).map(forms);
  }
  // A form matches at the start of a word. Short forms (four letters or fewer) must be the whole word or a simple
  // ending of it, so "star" finds stars and starry but not "start", and "ai" is not found inside "trail".
  const RX = new Map();
  const rx = f => {
    if (!RX.has(f)) {
      const e = f.replace(/[^a-z0-9 ]/g, '.');
      RX.set(f, new RegExp('(^|[^a-z])' + e + (f.length <= 2 ? '(s)?(?![a-z])' : f.length <= 4 ? '(s|es|ry|ing|ning|ming|ping|ging|er|ers|ed)?(?![a-z])' : ''), 'i'));
    }
    return RX.get(f);
  };
  const hit = (text, fs) => fs.some(f => rx(f).test(text));
  // phrases where a synonym means something else: clay pigeons are not pottery
  const UNLIKE = /clay (pigeon|target|shoot)[a-z]*|(^|[^a-z])clays(?![a-z])/gi;
  const synHit = (text, fs) => hit(String(text).replace(UNLIKE, ' '), fs);
  // text: everything searchable. Every typed word must match one of its forms.
  function match(text, ws) { return ws.every(fs => hit(text, fs.slice(0, 2)) || synHit(text, fs.slice(2))); }
  // higher is better: a word in the title counts for more than one elsewhere
  function score(title, text, ws) {
    let n = 0;
    // the word as typed (and its stem) counts for more than a synonym: "pottery" ranks the wheel above clay pigeons
    for (const fs of ws) { const own = fs.slice(0, 2), syn = fs.slice(2);
      n += hit(String(title), own) ? 8 : synHit(title, syn) ? 3 : 0;
      n += hit(text, own) ? 2 : synHit(text, syn) ? 1 : 0; }
    return n;
  }
  // how many of the typed words match (for the "closest matches" fallback when not every word does)
  function some(text, ws) { return ws.filter(fs => hit(text, fs.slice(0, 2)) || synHit(text, fs.slice(2))).length; }
  root.DDRFind = { words, match, score, some, stem };
  if (typeof module !== 'undefined') module.exports = root.DDRFind;
})(typeof window !== 'undefined' ? window : globalThis);
