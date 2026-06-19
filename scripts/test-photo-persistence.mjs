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
    };
    const idx = store.findIndex((entry) => entry.pathname === pathname);
    if (idx >= 0) store.splice(idx, 1, blob);
    else store.push(blob);
    return { ...blob };
  },
  async del(url) {
    const idx = store.findIndex((blob) => blob.url === url);
    if (idx >= 0) store.splice(idx, 1);
  },
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
  process.env.ADMIN_TOKEN = 'secret';

  const initial = await call('GET');
  if (initial.status !== 200 || Object.keys(initial.body.slots).length !== 0) {
    throw new Error('Initial GET should return empty slots');
  }

  const upload = await call('POST', {
    headers: {
      'content-type': 'image/png',
      'x-admin-token': 'secret',
      'x-slot-id': 'foto1',
    },
    body: 'fake-image-data',
  });
  if (upload.status !== 200 || !upload.body.slot?.u) {
    throw new Error('Upload failed');
  }

  const listed = await call('GET');
  if (listed.status !== 200 || listed.body.slots.foto1?.u !== upload.body.slot.u) {
    throw new Error('GET after upload did not return stored photo');
  }

  const removed = await call('DELETE', {
    headers: {
      'x-admin-token': 'secret',
      'x-slot-id': 'foto1',
    },
  });
  if (removed.status !== 200) {
    throw new Error('Delete failed');
  }

  const finalList = await call('GET');
  if (finalList.status !== 200 || finalList.body.slots.foto1) {
    throw new Error('Slot should be empty after delete');
  }

  console.log('photo persistence ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
