void (async () => {
  try {
    const baseUrl = new URL('data/', location.href).href;
    const defaults = 'u1_01_01,u1_01_02,u1_01_02v2,u1_01_03,u1_01_03v2,u2_02_01,u2_02_04,u2_02_04v2,u2_02_05,u2_02_05v2,u4_04_01,u4_04_01v2,u4_04_02,u4_04_02v2,u4_04_06,u5_05_02,u5_05_02v2,u5_05_03,u5_05_03v2,u6_06_02,u6_06_02v2,u6_06_03,u6_06_03v2';
    const input = prompt('Lesson IDs (comma/space separated). Leave default for the 23 known show_hide lessons:', defaults);
    if (input === null) return;
    const ids = input.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
    if (!ids.length) { alert('No IDs provided.'); return; }

    const SECTION_BG = '#7C3483';
    const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');
    const stripHtml = (html) => {
      const doc = new DOMParser().parseFromString(html || '', 'text/html');
      return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
    };
    const tagify = (s) => s.toLowerCase()
      .normalize('NFD').replace(COMBINING_MARKS, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'unknown';
    const safeCell = (s) => s.replace(/[\t\r\n]+/g, ' ');

    const extract = (id, data) => {
      let currentSection = 'unknown';
      const headerCells = (data.headers || []).filter(c => (c.backgroundColor || '').toUpperCase() === SECTION_BG);
      const firstHeading = headerCells.find(c => c.type !== 'audio' && c.sortOrder === 1)
                        || headerCells.find(c => c.type !== 'audio');
      if (firstHeading) {
        const name = stripHtml(firstHeading.content);
        if (name) currentSection = tagify(name);
      }
      const lines = [];
      for (const row of data.body || []) {
        const cells = row.cells || [];
        const isHeader = cells.some(c => (c.backgroundColor || '').toUpperCase() === SECTION_BG);
        if (isHeader) {
          const spCell = cells.find(c => c.sortOrder === 1 && c.type === 'text')
                      || cells.find(c => c.type === 'text');
          const name = stripHtml(spCell ? spCell.content : '');
          if (name) currentSection = tagify(name);
          continue;
        }
        const textCells = cells.filter(c => c.type === 'text');
        const sp = textCells.find(c => /lang=['"]es['"]/i.test(c.content || ''))
                || textCells.find(c => c.sortOrder === 1)
                || textCells[0];
        const en = textCells.find(c => c !== sp && c.sortOrder === (sp ? sp.sortOrder + 1 : 2))
                || textCells.find(c => c !== sp);
        const au = cells.find(c => c.type === 'audio');
        const spanish = safeCell(stripHtml(sp ? sp.content : ''));
        const english = safeCell(stripHtml(en ? en.content : ''));
        const audioUrl = au && au.contentSrc ? au.contentSrc : '';
        if (!spanish || !english) continue;
        const tags = 'Contrasena::lessons::' + tagify(id) + ' Contrasena::sections::' + currentSection;
        lines.push(spanish + '\t' + english + '\t' + tags + '\t' + audioUrl);
      }
      return lines;
    };

    const allLines = [];
    const summary = [];
    for (const id of ids) {
      try {
        const resp = await fetch(baseUrl + id + '/data.json');
        if (!resp.ok) { summary.push(id + ': HTTP ' + resp.status); continue; }
        const data = await resp.json();
        const lines = extract(id, data);
        summary.push(id + ': ' + lines.length + ' cards');
        allLines.push(...lines);
      } catch (e) {
        summary.push(id + ': error ' + (e && e.message ? e.message : e));
      }
    }

    if (!allLines.length) { alert('No cards extracted.\n\n' + summary.join('\n')); return; }

    const header = '#separator:tab\n#html:false\n#tags column:3\n';
    const tsv = header + allLines.join('\n') + '\n';
    const blob = new Blob([tsv], { type: 'text/tab-separated-values;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = 'contrasena_all.tsv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

    alert('Exported ' + allLines.length + ' cards from ' + ids.length + ' lessons.\n\n' + summary.join('\n'));
  } catch (e) {
    alert('Error: ' + (e && e.message ? e.message : e));
  }
})();
