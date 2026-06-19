import handler from '../api/photos.js';
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

async function call(method, { headers = {}, body = '' } = {}) {
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
        url: `https://mock.blob/${pathname.replace(/\\d+(?=\\.[a-z]+$)/, String(putCounter))}`,
        size: body?.length || 0,
        contentType: options.contentType || 'application/octet-stream',
        body: Buffer.from(body || []),
      };
      const idx = store.findIndex((entry) => entry.pathname === pathname);
      if (idx >= 0) store.splice(idx, 1, blob);
      else store.push(blob);
      return { ...blob };
    },
  };

  const initial = await call('GET');
  if (initial.status !== 200 || Object.keys(initial.body.slots).length !== 0) {
    throw new Error('Initial GET should return empty slots');
  }

  const upload1 = await call('POST', {
    headers: {
      'content-type': 'image/png',
      'x-slot-id': 'foto1',
    },
    body: 'fake-image-data-1',
  });
  if (upload1.status !== 200 || !upload1.body.slot?.u) {
    throw new Error('First upload failed');
  }
  if (!upload1.body.slot.u.startsWith('https://mock.blob/image-slots/foto1/active/')) {
    throw new Error(`First upload should return persisted blob URL, got ${upload1.body.slot.u}`);
  }

  const upload2 = await call('POST', {
    headers: {
      'content-type': 'image/png',
      'x-slot-id': 'foto1',
    },
    body: 'fake-image-data-2',
  });
  if (upload2.status !== 200 || !upload2.body.slot?.u) {
    throw new Error('Second upload failed');
  }

  const listed = await call('GET');
  if (listed.status !== 200 || !listed.body.slots.foto1?.u.startsWith('https://mock.blob/image-slots/foto1/active/')) {
    throw new Error('GET after replace did not return current photo');
  }
  if (!listed.body.archive?.foto1 || listed.body.archive.foto1.length < 1) {
    throw new Error('Archive should contain previous photo');
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
  const scriptSource = await import('node:fs/promises').then(fs => fs.readFile(new URL('../image-slot.js', import.meta.url), 'utf8'));
  let postCount = 0;
  const dom = new JSDOM('<!doctype html><html><body><image-slot id="foto1"></image-slot></body></html>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.test/' });
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
  const el = initialEl;
  await el._ingest({ type: 'image/png' });
  await flushMicrotasks(10);
  if (postCount < 1) {
    throw new Error('Browser ingest did not POST to /api/photos');
  }

  console.log('photo persistence ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
