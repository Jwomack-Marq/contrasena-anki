void (async () => {
  try {
    const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');
    const tagify = (s) => s.toLowerCase()
      .normalize('NFD').replace(COMBINING_MARKS, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'unknown';
    const safeCell = (s) => s.replace(/[\t\r\n]+/g, ' ');
    const cellText = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
    const cleanVerb = (v) => String(v || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    const GENERIC_COL = /^(verb\s+)?ending$|^conjugated\s+form$|^forms?$|^singular\s+form$|^plural\s+form$|^english$/i;

    // Grammar_2-1.html -> grammar_2_1
    const file = (location.pathname.split('/').pop() || 'grammar').replace(/\.html?$/i, '');
    const id = tagify(file);

    // Read every table on the page into a rows-of-cell-text grid.
    const tables = Array.from(document.querySelectorAll('table')).map(table =>
      Array.from(table.querySelectorAll('tr'))
        .map(tr => Array.from(tr.querySelectorAll('td,th')).map(cellText))
        .filter(r => r.length));

    // Strategy 1 — clean person×verb grid (header: Sujeto | verb | verb…).
    function gridPairs() {
      const SUBJ = /\b(sujeto|subject|pronombre|pronoun)\b/i;
      let rows = null;
      for (const t of tables) {
        const head = t[0] || [];
        if (head.length >= 2 && SUBJ.test(head[0]) && t.length >= 2) { rows = t; break; }
      }
      if (!rows) return [];
      const verbs = rows[0].slice(1).map(cleanVerb);
      const pairs = [];
      for (let r = 1; r < rows.length; r++) {
        const cols = rows[r];
        const subject = cols[0] || '';
        if (!subject) continue;
        for (let c = 1; c < cols.length && c <= verbs.length; c++) {
          const verb = verbs[c - 1], form = cols[c] || '';
          if (!verb || GENERIC_COL.test(verb) || !form) continue;
          pairs.push({ verb, subject, form });
        }
      }
      return pairs;
    }

    // Strategy 2 — "Forms" row holding each verb's whole conjugation as
    // pronoun-delimited text in one cell (saber/conocer, haber).
    const SUBJECTS = [
      { re: 'yo',                       label: 'yo (I)' },
      { re: 't[úu]',                    label: 'tú (you, informal)' },
      { re: 'él/ella[;/] *Ud\\.?',      label: 'él/ella; Ud. (he/she/it; you, formal)' },
      { re: 'nosotros/nosotras',        label: 'nosotros/nosotras (we)' },
      { re: 'vosotros/vosotras',        label: 'vosotros/vosotras (you all, informal)' },
      { re: 'ellos/ellas[;/] *Uds\\.?', label: 'ellos/ellas; Uds. (they; you, formal)' },
    ];
    function parseFormsCell(text) {
      const found = [];
      for (const s of SUBJECTS) {
        const m = new RegExp(s.re, 'i').exec(text);
        if (m) found.push({ idx: m.index, end: m.index + m[0].length, label: s.label });
      }
      found.sort((a, b) => a.idx - b.idx);
      const out = [];
      for (let i = 0; i < found.length; i++) {
        const start = found[i].end;
        const stop = i + 1 < found.length ? found[i + 1].idx : text.length;
        const form = text.slice(start, stop).replace(/^[\s—:.\-]+/, '').trim();
        if (form) out.push({ subject: found[i].label, form });
      }
      return out;
    }
    function formsRowPairs() {
      for (const rows of tables) {
        const header = rows[0] || [];
        const formsRow = rows.find(r => /^(forms?|conjugat)/i.test(r[0] || ''));
        if (header.length < 2 || !formsRow) continue;
        const pairs = [];
        for (let c = 1; c < header.length && c < formsRow.length; c++) {
          const verb = cleanVerb(header[c]);
          if (!verb || GENERIC_COL.test(verb)) continue;
          for (const { subject, form } of parseFormsCell(formsRow[c])) pairs.push({ verb, subject, form });
        }
        if (pairs.length) return pairs;
      }
      return [];
    }

    let pairs = gridPairs();
    if (!pairs.length) pairs = formsRowPairs();
    if (!pairs.length) { alert('No conjugation table found on this page.'); return; }

    const lines = pairs.map(({ verb, subject, form }) =>
      safeCell(form) + '\t' + safeCell(verb + ' — ' + subject) +
      '\t' + 'Contrasena::lessons::' + id + ' Contrasena::sections::' + tagify(verb) + '\t');

    const header = '#separator:tab\n#html:false\n#tags column:3\n';
    const tsv = header + lines.join('\n') + '\n';
    const blob = new Blob([tsv], { type: 'text/tab-separated-values;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = id + '.tsv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

    alert('Exported ' + lines.length + ' cards to ' + id + '.tsv\nNow in Anki: File → Import → pick this file.');
  } catch (e) {
    alert('Error: ' + (e && e.message ? e.message : e));
  }
})();
