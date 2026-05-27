void (async () => {
  try {
    const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');
    const tagify = (s) => s.toLowerCase()
      .normalize('NFD').replace(COMBINING_MARKS, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'unknown';
    const safeCell = (s) => s.replace(/[\t\r\n]+/g, ' ');
    const cellText = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();

    // Grammar_2-1.html -> grammar_2_1
    const file = (location.pathname.split('/').pop() || 'grammar').replace(/\.html?$/i, '');
    const id = tagify(file);

    // Pages have 2+ tables (a Q&A examples table AND the conjugation table).
    // Pick the one whose header's first cell names the subject column.
    const SUBJ = /\b(sujeto|subject|pronombre|pronoun)\b/i;
    let rows = null;
    for (const table of document.querySelectorAll('table')) {
      const grid = Array.from(table.querySelectorAll('tr'))
        .map(tr => Array.from(tr.querySelectorAll('td,th')).map(cellText));
      const head = grid[0] || [];
      if (head.length >= 2 && SUBJ.test(head[0]) && grid.length >= 2) { rows = grid; break; }
    }
    if (!rows) { alert('No conjugation table found on this page.'); return; }

    const verbs = rows[0].slice(1);
    const lines = [];
    for (let r = 1; r < rows.length; r++) {
      const cols = rows[r];
      const subject = cols[0] || '';
      if (!subject) continue;
      for (let c = 1; c < cols.length && c <= verbs.length; c++) {
        const verb = verbs[c - 1];
        const form = cols[c] || '';
        if (!verb || !form) continue;
        const tags = 'Contrasena::lessons::' + id + ' Contrasena::sections::' + tagify(verb);
        lines.push(safeCell(form) + '\t' + safeCell(verb + ' — ' + subject) + '\t' + tags + '\t');
      }
    }
    if (!lines.length) { alert('Conjugation table found but produced 0 cards.'); return; }

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
