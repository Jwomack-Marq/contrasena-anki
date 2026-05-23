void (async () => {
  try {
    const id = new URL(location.href).searchParams.get('id');
    if (!id) {
      alert('No lesson id in the URL. Open a Contraseña show_hide lesson page (one with ?id=... in the address) and click the bookmark again.');
      return;
    }

    const dataUrl = new URL('data/' + id + '/data.json', location.href).href;
    const resp = await fetch(dataUrl);
    if (!resp.ok) {
      alert('Failed to fetch lesson data: HTTP ' + resp.status + '\n' + dataUrl);
      return;
    }
    const data = await resp.json();

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

    // The first section's title lives in `headers` (acts as both column header
    // and section name); subsequent section titles appear inline in `body`.
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
      const sp = cells.find(c => c.sortOrder === 1 && c.type === 'text');
      const en = cells.find(c => c.sortOrder === 2 && c.type === 'text');
      const au = cells.find(c => c.type === 'audio');
      const spanish = safeCell(stripHtml(sp ? sp.content : ''));
      const english = safeCell(stripHtml(en ? en.content : ''));
      const audioUrl = au && au.contentSrc ? au.contentSrc : '';
      if (!spanish && !english) continue;
      const tags = 'Contrasena::lessons::' + tagify(id) + ' Contrasena::sections::' + currentSection;
      lines.push(spanish + '\t' + english + '\t' + tags + '\t' + audioUrl);
    }

    if (!lines.length) {
      alert('No cards found in this lesson (the body was empty).');
      return;
    }

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
