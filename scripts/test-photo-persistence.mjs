import photoHandler from '../api/photos.js';
import quotesHandler from '../api/quotes.js';
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

  const gallerySource = await import('node:fs/promises').then(fs => fs.readFile(new URL('../gallery.js', import.meta.url), 'utf8'));
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="gallery-grid"></div>
    <div id="archive-grid"></div>
    <input id="gallery-upload-input" type="file" multiple>
    <div id="gallery-status"></div>
    <div id="quotes-list"></div>
    <form id="quote-form"><input id="quote-author"><textarea id="quote-text"></textarea><span id="quote-status"></span></form>
  </body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.test/' });
  const { window } = dom;
  let photoPostCount = 0;
  let photoDeleteCount = 0;
  let quotePostCount = 0;
  let quoteDeleteCount = 0;
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
  window.Image = class MockImage {
    set src(value) {
      const match = /blob:mock-(\d+)x(\d+)/.exec(value || '');
      this.naturalWidth = Number(match?.[1] || 0);
      this.naturalHeight = Number(match?.[2] || 0);
      setTimeout(() => this.onload && this.onload(), 0);
    }
  };
  window.eval(gallerySource);
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
  await window.galleryApp.deletePhoto('p1');
  if (photoDeleteCount < 1) {
    throw new Error('Gallery delete should DELETE');
  }

  console.log('photo persistence ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
