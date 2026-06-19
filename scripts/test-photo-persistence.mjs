import handler from '../api/photos.js';

const store = [];

globalThis.__blobMock = {
  async list({ prefix = '' } = {}) {
    return {
      blobs: store.filter((blob) => blob.pathname.startsWith(prefix)).map((blob) => ({ ...blob })),
    };
  },
  async put(pathname, body, { contentType = 'application/octet-stream' } = {}) {
    const blob = {
      pathname,
      uploadedAt: new Date().toISOString(),
      url: `https://mock.blob/${pathname}`,
      size: body?.length || 0,
      contentType,
      body: Buffer.from(body || []),
    };
    const idx = store.findIndex((entry) => entry.pathname === pathname);
    if (idx >= 0) store.splice(idx, 1, blob);
    else store.push(blob);
    return { ...blob };
  },
};

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

async function main() {
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
  if (listed.status !== 200 || listed.body.slots.foto1?.u !== upload2.body.slot.u) {
    throw new Error('GET after replace did not return current photo');
  }
  if (!listed.body.archive?.foto1 || listed.body.archive.foto1.length < 1) {
    throw new Error('Archive should contain previous photo');
  }

  console.log('photo persistence ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
