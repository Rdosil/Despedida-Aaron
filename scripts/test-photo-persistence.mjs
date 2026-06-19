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

  const initial = await call(photoHandler, 'GET');
  if (initial.status !== 200 || Object.keys(initial.body.slots).length !== 0) {
    throw new Error('Initial GET should return empty slots');
  }

  const upload1 = await call(photoHandler, 'POST', {
    headers: {
      'content-type': 'image/png',
      'x-slot-id': 'foto1',
    },
    body: 'fake-image-data-1',
  });
  if (upload1.status !== 200 || !upload1.body.slot?.u) {
    throw new Error('First upload failed');
  }

  const upload2 = await call(photoHandler, 'POST', {
    headers: {
      'content-type': 'image/png',
      'x-slot-id': 'foto1',
    },
    body: 'fake-image-data-2',
  });
  if (upload2.status !== 200 || !upload2.body.slot?.u) {
    throw new Error('Second upload failed');
  }

  const listed = await call(photoHandler, 'GET');
  if (listed.status !== 200 || !listed.body.slots.foto1?.u.startsWith('https://mock.blob/image-slots/foto1/active/')) {
    throw new Error('GET after replace did not return current photo');
  }
  if (!listed.body.archive?.foto1 || listed.body.archive.foto1.length < 1) {
    throw new Error('Archive should contain previous photo');
  }

  const deleted = await call(photoHandler, 'DELETE', {
    headers: { 'x-slot-id': 'foto1' },
  });
  if (deleted.status !== 200 || !deleted.body?.ok) {
    throw new Error('DELETE should succeed');
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
  const quotesAfter = await call(quotesHandler, 'GET');
  if (quotesAfter.status !== 200 || quotesAfter.body.quotes[0]?.text !== 'Outra ronda e falamos.') {
    throw new Error('Quotes GET should show newest quote first');
  }

  const remoteMerge = {
    slots: {
      foto1: {
        u: 'https://mock.blob/image-slots/foto1/active/merged.webp',
        s: 1,
        x: 0,
        y: 0,
      },
    },
    archive: {},
  };
  const quotesPayload = {
    quotes: [
      { id: 'q1', text: 'Se hai curva, hai interior.', author: 'Aarón', created_at: '2026-06-01T12:00:00.000Z' },
      { id: 'q2', text: 'Outra ronda e falamos.', author: 'Gelo', created_at: '2026-06-02T10:00:00.000Z' },
    ],
  };

  const scriptSource = await import('node:fs/promises').then(fs => fs.readFile(new URL('../image-slot.js', import.meta.url), 'utf8'));
  let postCount = 0;
  let deleteCount = 0;
  let quotePostCount = 0;
  const dom = new JSDOM(`<!doctype html><html><body>
    <image-slot id="foto1"></image-slot>
    <div id="quotes-list"></div>
    <form id="quote-form"><input id="quote-author"><textarea id="quote-text"></textarea><span id="quote-status"></span></form>
  </body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.test/' });
  const { window } = dom;
  window.fetch = async (url, options = {}) => {
    if (url === '/api/photos' && (!options.method || options.method === 'GET')) {
      return { ok: true, async json() { return remoteMerge; } };
    }
    if (url === '/api/photos' && options.method === 'POST') {
      postCount += 1;
      return {
        ok: true,
        async json() {
          return { slot: { u: 'https://mock.blob/image-slots/foto1/active/123.webp', updated_at: new Date().toISOString(), pathname: 'image-slots/foto1/active/123.webp' } };
        },
      };
    }
    if (url === '/api/photos' && options.method === 'DELETE') {
      deleteCount += 1;
      return {
        ok: true,
        async json() {
          return { ok: true, deleted: 1, slotId: 'foto1' };
        },
      };
    }
    if (url === '/api/quotes' && (!options.method || options.method === 'GET')) {
      return { ok: true, async json() { return quotesPayload; } };
    }
    if (url === '/api/quotes' && options.method === 'POST') {
      quotePostCount += 1;
      return {
        ok: true,
        async json() {
          return { quote: { id: 'q3', text: 'Nova frase', author: 'Teo', created_at: new Date().toISOString() } };
        },
      };
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  window.createImageBitmap = async () => ({ width: 10, height: 10, close() {} });
  window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/webp;base64,ZmFrZQ==';
  class FakeResizeObserver { observe() {} disconnect() {} }
  window.ResizeObserver = FakeResizeObserver;
  window.eval(scriptSource);
  await flushMicrotasks(10);
  const initialEl = window.document.querySelector('image-slot');
  if (!initialEl.shadowRoot.querySelector('.frame img')?.getAttribute('src')?.includes('merged.webp')) {
    throw new Error('Initial remote load did not render blob URL');
  }
  await initialEl._ingest({ type: 'image/png' });
  await flushMicrotasks(10);
  if (postCount < 1) {
    throw new Error('Browser ingest did not POST to /api/photos');
  }
  await initialEl._deleteCurrent();
  await flushMicrotasks(10);
  if (deleteCount < 1) {
    throw new Error('Browser delete did not DELETE /api/photos');
  }

  const renderQuotes = new window.Function(`
    function escapeHtml(value){ return String(value || '').replace(/[&<>\"']/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;', "'":'&#39;' }[ch])); }
    function quoteCard(item){
      const author = escapeHtml(item.author || 'Anónimo');
      const text = escapeHtml(item.text || '');
      const when = item.created_at ? new Date(item.created_at).toLocaleString('gl-ES') : 'sen data';
      return '<article class="quote-card"><p class="quote-text">“' + text + '”</p><div class="quote-meta">' + author + ' · ' + when + '</div></article>';
    }
    async function renderQuotes(){
      const container = document.getElementById('quotes-list');
      if(!container) return;
      const res = await fetch('/api/quotes', { cache: 'no-store' });
      const data = await res.json();
      const quotes = Array.isArray(data?.quotes) ? data.quotes : [];
      container.innerHTML = quotes.map(quoteCard).join('');
    }
    async function setupQuoteForm(){
      const form = document.getElementById('quote-form');
      const status = document.getElementById('quote-status');
      const textInput = document.getElementById('quote-text');
      const authorInput = document.getElementById('quote-author');
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const res = await fetch('/api/quotes', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ text: textInput.value.trim(), author: authorInput.value.trim() }) });
        if(res.ok){ status.textContent = 'Frase gardada.'; }
      });
    }
    return { renderQuotes, setupQuoteForm };
  `)();
  await renderQuotes.renderQuotes();
  if (!window.document.getElementById('quotes-list').innerHTML.includes('Outra ronda e falamos.')) {
    throw new Error('Quotes render should show fetched quotes');
  }
  await renderQuotes.setupQuoteForm();
  window.document.getElementById('quote-text').value = 'Nova frase';
  window.document.getElementById('quote-author').value = 'Teo';
  window.document.getElementById('quote-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await flushMicrotasks(10);
  if (quotePostCount < 1) {
    throw new Error('Quote form should POST to /api/quotes');
  }

  console.log('photo persistence ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
