import photoHandler from '../api/photos.js';
import quotesHandler from '../api/quotes.js';
import challengesHandler from '../api/challenges.js';
import { JSDOM } from 'jsdom';

const store = [];
let putCounter = 0;

globalThis.fetch = async (url) => {
  const found = store.find((blob) => blob.url === url);
  if (!found) throw new Error(`mock blob not found: ${url}`);
  return {
    async arrayBuffer() {
      const view = found.body;
      return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    },
    async text() {
      return found.body.toString('utf8');
    },
  };
};

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    end(payload) { this.body = payload; },
  };
}

async function call(handler, method, { headers = {}, body = '' } = {}) {
  const req = {
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      if (body) yield Buffer.from(body);
    },
  };
  const res = createRes();
  await handler(req, res);
  const parsed = res.body ? JSON.parse(res.body) : null;
  return { status: res.statusCode, body: parsed };
}

async function flushMicrotasks(times = 3) {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function main() {
  globalThis.__blobMock = {
    async list({ prefix = '' } = {}) {
      return {
        blobs: store.filter((blob) => blob.pathname.startsWith(prefix)).map((blob) => ({ ...blob })),
      };
    },
    async put(pathname, body, options = {}) {
      if (options.access !== 'public') {
        throw new Error('mock requires public access');
      }
      putCounter += 1;
      const blob = {
        pathname,
        uploadedAt: new Date().toISOString(),
        url: `https://mock.blob/${pathname.replace(/\d+(?=\.[a-z]+$)/, String(putCounter))}`,
        size: body?.length || 0,
        contentType: options.contentType || 'application/octet-stream',
        body: Buffer.isBuffer(body) ? Buffer.from(body) : Buffer.from(String(body || '')),
      };
      const idx = store.findIndex((entry) => entry.pathname === pathname);
      if (idx >= 0) store.splice(idx, 1, blob);
      else store.push(blob);
      return { ...blob };
    },
    async del(urlOrPathname) {
      const targets = Array.isArray(urlOrPathname) ? urlOrPathname : [urlOrPathname];
      for (const target of targets) {
        const idx = store.findIndex((entry) => entry.url === target || entry.pathname === target);
        if (idx >= 0) store.splice(idx, 1);
      }
    },
  };

  const empty = await call(photoHandler, 'GET');
  if (empty.status !== 200 || !Array.isArray(empty.body.photos) || empty.body.photos.length !== 0) {
    throw new Error('Initial gallery GET should be empty');
  }

  const uploadPortrait = await call(photoHandler, 'POST', {
    headers: { 'content-type': 'image/png', 'x-photo-orientation': 'portrait' },
    body: 'fake-image-data-1',
  });
  if (uploadPortrait.status !== 200 || uploadPortrait.body.photo?.orientation !== 'portrait') {
    throw new Error('Portrait upload failed');
  }

  const uploadMissingType = await call(photoHandler, 'POST', {
    headers: { 'content-type': 'image/jpeg', 'x-photo-orientation': 'portrait' },
    body: 'fake-image-data-1b',
  });
  if (uploadMissingType.status !== 200 || uploadMissingType.body.photo?.orientation !== 'portrait') {
    throw new Error('Fallback content-type upload failed');
  }

  const uploadHeic = await call(photoHandler, 'POST', {
    headers: { 'content-type': 'image/heic', 'x-photo-orientation': 'portrait' },
    body: 'fake-image-data-heic',
  });
  if (uploadHeic.status !== 200 || !String(uploadHeic.body.photo?.pathname || '').endsWith('.heic')) {
    throw new Error('HEIC upload failed');
  }

  const uploadLandscape = await call(photoHandler, 'POST', {
    headers: { 'content-type': 'image/png', 'x-photo-orientation': 'landscape' },
    body: 'fake-image-data-2',
  });
  if (uploadLandscape.status !== 200 || uploadLandscape.body.photo?.orientation !== 'landscape') {
    throw new Error('Landscape upload failed');
  }

  const listed = await call(photoHandler, 'GET');
  if (listed.status !== 200 || listed.body.photos.length !== 4) {
    throw new Error('Gallery GET should return all uploaded photos');
  }
  if (!listed.body.photos.some((photo) => photo.orientation === 'portrait')) {
    throw new Error('Gallery GET should include portrait item');
  }

  const deleted = await call(photoHandler, 'DELETE', {
    headers: { 'x-photo-id': uploadPortrait.body.photo.id },
  });
  if (deleted.status !== 200 || !deleted.body.ok) {
    throw new Error('Gallery DELETE should succeed');
  }

  const quotesInitial = await call(quotesHandler, 'GET');
  if (quotesInitial.status !== 200 || !Array.isArray(quotesInitial.body.quotes) || quotesInitial.body.quotes.length < 3) {
    throw new Error('Quotes GET should return defaults');
  }
  const quoteSaved = await call(quotesHandler, 'POST', {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Outra ronda e falamos.', author: 'Gelo' }),
  });
  if (quoteSaved.status !== 200 || !quoteSaved.body.quote?.text.includes('Outra ronda')) {
    throw new Error('Quotes POST should persist a new quote');
  }
  const quoteUpdated = await call(quotesHandler, 'POST', {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: quoteSaved.body.quote.id, text: 'Outra ronda e marchamos.', author: 'Gelo editado' }),
  });
  if (quoteUpdated.status !== 200 || quoteUpdated.body.quote?.text !== 'Outra ronda e marchamos.') {
    throw new Error('Quotes POST with id should edit quote');
  }
  const quoteDeleted = await call(quotesHandler, 'DELETE', {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: quoteSaved.body.quote.id }),
  });
  if (quoteDeleted.status !== 200 || quoteDeleted.body.deleted !== quoteSaved.body.quote.id) {
    throw new Error('Quotes DELETE should remove quote');
  }

  const challengesInitial = await call(challengesHandler, 'GET');
  if (challengesInitial.status !== 200 || challengesInitial.body.items?.length !== 8 || challengesInitial.body.items?.[0]?.text !== 'Facer a pole (ou intentalo con honra) no karting.' || challengesInitial.body.done?.r8 !== false) {
    throw new Error('Challenges GET should return default shared challenges');
  }
  const challengesSaved = await call(challengesHandler, 'POST', {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      items: [
        { id: 'r1', text: 'Novo reto 1' },
        { id: 'r2', text: 'Novo reto 2' },
        { id: 'r3', text: 'Novo reto 3' },
        { id: 'r4', text: 'Novo reto 4' },
        { id: 'r5', text: 'Novo reto 5' },
        { id: 'r6', text: 'Novo reto 6' },
        { id: 'r7', text: 'Novo reto 7' },
        { id: 'r8', text: 'Novo reto 8' },
        { id: 'nope', text: 'Ignorar' },
      ],
      done: { r1: true, r3: true, r8: true, nope: true },
    }),
  });
  if (challengesSaved.status !== 200 || challengesSaved.body.done?.r1 !== true || challengesSaved.body.done?.r2 !== false || challengesSaved.body.items?.[0]?.text !== 'Novo reto 1' || challengesSaved.body.items?.some((item) => item.id === 'nope')) {
    throw new Error('Challenges POST should persist only known challenge items and flags');
  }
  const challengesListed = await call(challengesHandler, 'GET');
  if (challengesListed.status !== 200 || challengesListed.body.done?.r3 !== true || challengesListed.body.done?.r8 !== true || challengesListed.body.items?.[7]?.text !== 'Novo reto 8') {
    throw new Error('Challenges GET should return persisted items and flags');
  }

  const gallerySource = await import('node:fs/promises').then(fs => fs.readFile(new URL('../gallery.js', import.meta.url), 'utf8'));
  const indexSource = await import('node:fs/promises').then(fs => fs.readFile(new URL('../index.html', import.meta.url), 'utf8'));
  const retosBody = indexSource.match(/\/\* RETOS_INLINE_START \*\/([\s\S]*?)\/\* RETOS_INLINE_END \*\//);
  if (!retosBody) {
    throw new Error('Retos script should exist in index.html');
  }
  const retosScript = retosBody[1];
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="gallery-grid"></div>
    <div id="archive-grid"></div>
    <input id="gallery-upload-input" type="file" multiple>
    <div id="gallery-status"></div>
    <div id="quotes-list"></div>
    <form id="quote-form"><input id="quote-author"><textarea id="quote-text"></textarea><span id="quote-status"></span></form>
    <div class="retos" id="retos">
      <div class="card reto" data-id="r1"><div class="reto-display"><div class="box-c">✓</div><div class="rt">R1</div><div class="reto-toolbar"><button class="reto-action" type="button" data-act="edit">Editar</button><button class="reto-action" type="button" data-act="delete">Borrar</button></div></div><form class="reto-editor"><input class="reto-edit-input" name="text" maxlength="180" value="R1" placeholder="Edita o reto"><div class="reto-editor-actions"><button class="reto-action" type="submit">Gardar</button><button class="reto-action" type="button" data-act="cancel">Cancelar</button></div></form></div>
      <div class="card reto" data-id="r2"><div class="reto-display"><div class="box-c">✓</div><div class="rt">R2</div><div class="reto-toolbar"><button class="reto-action" type="button" data-act="edit">Editar</button><button class="reto-action" type="button" data-act="delete">Borrar</button></div></div><form class="reto-editor"><input class="reto-edit-input" name="text" maxlength="180" value="R2" placeholder="Edita o reto"><div class="reto-editor-actions"><button class="reto-action" type="submit">Gardar</button><button class="reto-action" type="button" data-act="cancel">Cancelar</button></div></form></div>
      <div class="card reto" data-id="r3"><div class="reto-display"><div class="box-c">✓</div><div class="rt">R3</div><div class="reto-toolbar"><button class="reto-action" type="button" data-act="edit">Editar</button><button class="reto-action" type="button" data-act="delete">Borrar</button></div></div><form class="reto-editor"><input class="reto-edit-input" name="text" maxlength="180" value="R3" placeholder="Edita o reto"><div class="reto-editor-actions"><button class="reto-action" type="submit">Gardar</button><button class="reto-action" type="button" data-act="cancel">Cancelar</button></div></form></div>
      <div class="card reto" data-id="r4"><div class="reto-display"><div class="box-c">✓</div><div class="rt">R4</div><div class="reto-toolbar"><button class="reto-action" type="button" data-act="edit">Editar</button><button class="reto-action" type="button" data-act="delete">Borrar</button></div></div><form class="reto-editor"><input class="reto-edit-input" name="text" maxlength="180" value="R4" placeholder="Edita o reto"><div class="reto-editor-actions"><button class="reto-action" type="submit">Gardar</button><button class="reto-action" type="button" data-act="cancel">Cancelar</button></div></form></div>
      <div class="card reto" data-id="r5"><div class="reto-display"><div class="box-c">✓</div><div class="rt">R5</div><div class="reto-toolbar"><button class="reto-action" type="button" data-act="edit">Editar</button><button class="reto-action" type="button" data-act="delete">Borrar</button></div></div><form class="reto-editor"><input class="reto-edit-input" name="text" maxlength="180" value="R5" placeholder="Edita o reto"><div class="reto-editor-actions"><button class="reto-action" type="submit">Gardar</button><button class="reto-action" type="button" data-act="cancel">Cancelar</button></div></form></div>
      <div class="card reto" data-id="r6"><div class="reto-display"><div class="box-c">✓</div><div class="rt">R6</div><div class="reto-toolbar"><button class="reto-action" type="button" data-act="edit">Editar</button><button class="reto-action" type="button" data-act="delete">Borrar</button></div></div><form class="reto-editor"><input class="reto-edit-input" name="text" maxlength="180" value="R6" placeholder="Edita o reto"><div class="reto-editor-actions"><button class="reto-action" type="submit">Gardar</button><button class="reto-action" type="button" data-act="cancel">Cancelar</button></div></form></div>
      <div class="card reto" data-id="r7"><div class="reto-display"><div class="box-c">✓</div><div class="rt">R7</div><div class="reto-toolbar"><button class="reto-action" type="button" data-act="edit">Editar</button><button class="reto-action" type="button" data-act="delete">Borrar</button></div></div><form class="reto-editor"><input class="reto-edit-input" name="text" maxlength="180" value="R7" placeholder="Edita o reto"><div class="reto-editor-actions"><button class="reto-action" type="submit">Gardar</button><button class="reto-action" type="button" data-act="cancel">Cancelar</button></div></form></div>
      <div class="card reto" data-id="r8"><div class="reto-display"><div class="box-c">✓</div><div class="rt">R8</div><div class="reto-toolbar"><button class="reto-action" type="button" data-act="edit">Editar</button><button class="reto-action" type="button" data-act="delete">Borrar</button></div></div><form class="reto-editor"><input class="reto-edit-input" name="text" maxlength="180" value="R8" placeholder="Edita o reto"><div class="reto-editor-actions"><button class="reto-action" type="submit">Gardar</button><button class="reto-action" type="button" data-act="cancel">Cancelar</button></div></form></div>
    </div>
    <div id="reto-score"></div>
  </body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.test/' });
  const { window } = dom;
  let photoPostCount = 0;
  let photoDeleteCount = 0;
  let quotePostCount = 0;
  let quoteDeleteCount = 0;
  let challengeGetCount = 0;
  let challengePostCount = 0;
  let currentDone = { r1: false, r2: false, r3: false, r4: false, r5: false, r6: false, r7: false, r8: false };
  let currentItems = [
    { id: 'r1', text: 'R1' },
    { id: 'r2', text: 'R2' },
    { id: 'r3', text: 'R3' },
    { id: 'r4', text: 'R4' },
    { id: 'r5', text: 'R5' },
    { id: 'r6', text: 'R6' },
    { id: 'r7', text: 'R7' },
    { id: 'r8', text: 'R8' },
  ];
  window.fetch = async (url, options = {}) => {
    if (url === '/api/photos' && (!options.method || options.method === 'GET')) {
      return {
        ok: true,
        async json() {
          return {
            photos: [
              { id: 'p1', u: 'https://mock.blob/gallery/p1/active/1-portrait.png', orientation: 'portrait', updated_at: new Date().toISOString() },
              { id: 'p2', u: 'https://mock.blob/gallery/p2/active/2-landscape.png', orientation: 'landscape', updated_at: new Date().toISOString() },
            ],
            archive: [],
          };
        },
      };
    }
    if (url === '/api/photos' && options.method === 'POST') {
      photoPostCount += 1;
      const bodySize = options.body?.byteLength ?? options.body?.length ?? 0;
      if (photoPostCount === 6 && bodySize >= 4_997_422) {
        throw new Error('Large JPEG uploads should be downscaled before POST');
      }
      return {
        ok: true,
        async json() {
          return { photo: { id: 'p3', u: 'https://mock.blob/gallery/p3/active/3-portrait.png', orientation: 'portrait', updated_at: new Date().toISOString() } };
        },
      };
    }
    if (url === '/api/photos' && options.method === 'DELETE') {
      photoDeleteCount += 1;
      return {
        ok: true,
        async json() {
          return { ok: true, deleted: 1, photoId: 'p1' };
        },
      };
    }
    if (url === '/api/quotes' && (!options.method || options.method === 'GET')) {
      return { ok: true, async json() { return { quotes: [{ id: 'q1', text: 'Se hai curva, hai interior.', author: 'Aarón', created_at: '2026-06-01T12:00:00.000Z' }] }; } };
    }
    if (url === '/api/quotes' && options.method === 'POST') {
      quotePostCount += 1;
      return { ok: true, async json() { return { quote: { id: 'q2', text: 'Nova frase', author: 'Teo', created_at: new Date().toISOString() } }; } };
    }
    if (url === '/api/quotes' && options.method === 'DELETE') {
      quoteDeleteCount += 1;
      return { ok: true, async json() { return { ok: true, deleted: 'q1' }; } };
    }
    if (url === '/api/challenges' && (!options.method || options.method === 'GET')) {
      challengeGetCount += 1;
      return { ok: true, async json() { return { items: currentItems.map((item) => ({ ...item })), done: { ...currentDone } }; } };
    }
    if (url === '/api/challenges' && options.method === 'POST') {
      challengePostCount += 1;
      const payload = JSON.parse(String(options.body || '{}'));
      currentDone = { ...currentDone, ...(payload.done || {}) };
      if (Array.isArray(payload.items)) {
        currentItems = payload.items.map((item) => ({ ...item }));
      }
      return { ok: true, async json() { return { ok: true, items: currentItems.map((item) => ({ ...item })), done: { ...currentDone } }; } };
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  window.createImageBitmap = async (file) => {
    if (file.__failBitmap) {
      const err = new Error('The source image could not be decoded.');
      err.name = 'InvalidStateError';
      throw err;
    }
    return { width: file.__width || 1200, height: file.__height || 800, close() {} };
  };
  window.URL.createObjectURL = (file) => `blob:mock-${file.__width || 0}x${file.__height || 0}`;
  window.URL.revokeObjectURL = () => {};
  const realCreateElement = window.document.createElement.bind(window.document);
  window.document.createElement = (tagName, options) => {
    const el = realCreateElement(tagName, options);
    if (String(tagName).toLowerCase() === 'canvas') {
      el.getContext = () => ({ drawImage() {} });
      el.toBlob = (cb, type) => cb(new window.Blob([new Uint8Array([1, 2, 3, 4])], { type: type || 'image/jpeg' }));
    }
    return el;
  };
  window.Image = class MockImage {
    set src(value) {
      const match = /blob:mock-(\d+)x(\d+)/.exec(value || '');
      this.naturalWidth = Number(match?.[1] || 0);
      this.naturalHeight = Number(match?.[2] || 0);
      setTimeout(() => this.onload && this.onload(), 0);
    }
  };
  window.eval(gallerySource);
  window.eval(retosScript);
  await window.galleryApp.renderGallery();
  if (!window.document.getElementById('gallery-grid').innerHTML.includes('data-orientation="portrait"')) {
    throw new Error('Gallery render should show portrait card');
  }
  if (!window.document.getElementById('gallery-grid').innerHTML.includes('data-orientation="landscape"')) {
    throw new Error('Gallery render should show landscape card');
  }
  const portraitMarkup = window.document.getElementById('gallery-grid').innerHTML;
  if (!portraitMarkup.includes('data-orientation="portrait"')) {
    throw new Error('Portrait card markup missing');
  }
  if (!portraitMarkup.includes('download=')) {
    throw new Error('Gallery cards should expose a download link');
  }
  await window.galleryApp.uploadPhoto({
    type: '',
    __width: 700,
    __height: 1200,
    async arrayBuffer() { return new Uint8Array([1, 2, 3]).buffer; },
  });
  if (photoPostCount < 1) {
    throw new Error('Gallery upload should POST');
  }
  await window.galleryApp.uploadPhoto({
    type: 'image/png',
    __width: 700,
    __height: 1200,
    async arrayBuffer() { return new Uint8Array([1, 2, 3]).buffer; },
  });
  if (photoPostCount < 2) {
    throw new Error('Gallery upload with explicit type should POST');
  }
  await window.galleryApp.uploadPhoto({
    type: 'image/jpeg',
    __width: 700,
    __height: 1200,
    __failBitmap: true,
    async arrayBuffer() { return new Uint8Array([4, 5, 6]).buffer; },
  });
  if (photoPostCount < 3) {
    throw new Error('Gallery upload should still POST when orientation decode fails');
  }
  await window.galleryApp.uploadPhoto({
    type: 'image/heic',
    __width: 960,
    __height: 1280,
    async arrayBuffer() { return new Uint8Array([7, 8, 9]).buffer; },
  });
  if (photoPostCount < 4) {
    throw new Error('Gallery upload should POST HEIC files too');
  }
  await window.galleryApp.uploadPhoto({
    type: 'image/gif',
    __width: 640,
    __height: 640,
    async arrayBuffer() { return new Uint8Array([10, 11, 12]).buffer; },
  });
  if (photoPostCount < 5) {
    throw new Error('Gallery upload should POST files even for unsupported browser image types');
  }
  await window.galleryApp.uploadPhoto({
    type: 'image/jpeg',
    size: 4_997_422,
    __width: 3072,
    __height: 4096,
    async arrayBuffer() { return new Uint8Array([13, 14, 15]).buffer; },
  });
  if (photoPostCount < 6) {
    throw new Error('Large JPEG uploads should be downscaled before POST');
  }
  await window.galleryApp.deletePhoto('p1');
  if (photoDeleteCount < 1) {
    throw new Error('Gallery delete should DELETE');
  }
  await flushMicrotasks(8);
  if (challengeGetCount < 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushMicrotasks(8);
  }
  if (challengeGetCount < 1) {
    throw new Error('Challenges should load shared state on boot');
  }
  const firstChallenge = window.document.querySelector('.reto[data-id="r1"]');
  if (!firstChallenge) {
    throw new Error('Challenge card should exist in DOM');
  }
  const firstText = firstChallenge.querySelector('.rt');
  if (!firstText) {
    throw new Error('Challenge card text should exist in DOM');
  }
  firstChallenge.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await flushMicrotasks(4);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushMicrotasks(4);
  if (challengePostCount < 1) {
    throw new Error('Challenge toggle should persist shared state');
  }
  const editButton = firstChallenge.querySelector('[data-act="edit"]');
  if (!editButton) {
    throw new Error('Challenge card should expose edit button');
  }
  editButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await flushMicrotasks(2);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const refreshedChallenge = window.document.querySelector('.reto[data-id="r1"]');
  const editor = refreshedChallenge?.querySelector('.reto-editor');
  const textInput = refreshedChallenge?.querySelector('.reto-edit-input');
  if (!editor || !textInput) {
    throw new Error('Challenge card should open inline editor');
  }
  textInput.value = 'R1 editado';
  editor.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await flushMicrotasks(4);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushMicrotasks(4);
  if (challengePostCount < 2 || currentItems[0]?.text !== 'R1 editado') {
    throw new Error('Challenge edit should persist shared copy');
  }
  if (!window.document.querySelector('.reto[data-id="r1"] .rt')?.textContent?.includes('R1 editado')) {
    throw new Error('Challenge edit should update rendered text');
  }
  const deleteButton = window.document.querySelector('.reto[data-id="r1"] [data-act="delete"]');
  if (!deleteButton) {
    throw new Error('Challenge card should expose delete button');
  }
  deleteButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await flushMicrotasks(4);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushMicrotasks(4);
  if (challengePostCount < 3 || currentItems[0]?.text !== '') {
    throw new Error('Challenge delete should persist cleared copy');
  }
  if (window.document.querySelector('.reto[data-id="r1"] .rt')?.textContent?.trim() !== 'Reto eliminado') {
    throw new Error('Deleted challenge should render placeholder text');
  }

  console.log('photo persistence ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
