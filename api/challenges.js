import { del as blobDel, list as blobList, put as blobPut } from '@vercel/blob';

const PREFIX = 'challenges/';
const CONTENT_TYPE = 'application/json; charset=utf-8';
const DEFAULT_CHALLENGES = [
  { id: 'r1', text: 'Facer a pole (ou intentalo con honra) no karting.' },
  { id: 'r2', text: 'Pedir a cea enteira imitando a un comentarista deportivo.' },
  { id: 'r3', text: 'Soltar un discurso de 30 segundos agradecendo ao «seu equipo».' },
  { id: 'r4', text: 'Responder durante 10 minutos a todo como se estivese nunha rolda de prensa pre-boda.' },
  { id: 'r5', text: 'Entregar o seu número a unha descoñecida cunha frase digna de expulsión inmediata.' },
  { id: 'r6', text: 'Conseguir unha foto co camareiro máis serio… sorrindo.' },
  { id: 'r7', text: 'Bailar «o robot» polo menos unha vez na noite.' },
  { id: 'r8', text: 'Conseguir que tres descoñecidas lle dean un consello matrimonial.' },
  { id: 'r9', text: 'Dirixirse a unha chavala e preguntarlle: «Qué opinas de José Luis Ábalos? Yo creo que ni los buenos son tan buenos ni los malos son tan malos».' },
  { id: 'r10', text: 'Conseguir dobrar a Tanque Eloy.' },
];
const DEFAULT_DONE = Object.fromEntries(DEFAULT_CHALLENGES.map((item) => [item.id, false]));
const VALID_IDS = new Set(DEFAULT_CHALLENGES.map((item) => item.id));

function json(res, status, payload) {
  res.status(status);
  res.setHeader('Content-Type', CONTENT_TYPE);
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function listBlobs(options) {
  if (globalThis.__blobMock?.list) return globalThis.__blobMock.list(options);
  return blobList(options);
}

async function putPublicBlob(pathname, body, options) {
  if (globalThis.__blobMock?.put) return globalThis.__blobMock.put(pathname, body, { ...options, access: 'public' });
  return blobPut(pathname, body, { ...options, access: 'public' });
}

async function deleteBlob(urlOrPathname, options) {
  if (globalThis.__blobMock?.del) return globalThis.__blobMock.del(urlOrPathname, options);
  return blobDel(urlOrPathname, options);
}

function sanitizeText(value, max = 180) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeDoneMap(raw, items = DEFAULT_CHALLENGES) {
  const next = Object.fromEntries(items.map((item) => [item.id, false]));
  if (!raw || typeof raw !== 'object') return next;
  for (const item of items) {
    next[item.id] = Boolean(raw[item.id]);
  }
  return next;
}

function normalizeChallengeItems(raw) {
  if (!Array.isArray(raw)) {
    return DEFAULT_CHALLENGES.map((item) => ({ ...item }));
  }
  const byId = new Map(raw.map((item) => [String(item?.id || '').trim(), sanitizeText(item?.text)]));
  return DEFAULT_CHALLENGES.map((item) => ({
    id: item.id,
    text: VALID_IDS.has(item.id) ? (byId.get(item.id) ?? item.text) : item.text,
  }));
}

async function loadChallengesBlob() {
  const listing = await listBlobs({ prefix: PREFIX });
  const blobs = (listing.blobs || []).slice().sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
  return blobs[0] || null;
}

async function readChallenges() {
  const latest = await loadChallengesBlob();
  if (!latest) {
    const items = DEFAULT_CHALLENGES.map((item) => ({ ...item }));
    return { items, done: normalizeDoneMap({}, items) };
  }
  const text = await fetch(latest.url).then((r) => r.text());
  const parsed = JSON.parse(text);
  const items = normalizeChallengeItems(parsed?.items);
  return {
    items,
    done: normalizeDoneMap(parsed?.done, items),
  };
}

async function writeChallenges(state) {
  const pathname = `${PREFIX}${Date.now()}.json`;
  await putPublicBlob(pathname, JSON.stringify(state, null, 2), {
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: CONTENT_TYPE,
  });
  const listing = await listBlobs({ prefix: PREFIX });
  const stale = (listing.blobs || [])
    .filter((blob) => blob.pathname !== pathname)
    .map((blob) => blob.url || blob.pathname)
    .filter(Boolean);
  if (stale.length) await deleteBlob(stale);
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const state = await readChallenges();
      return json(res, 200, state);
    } catch (error) {
      return json(res, 500, { error: 'Could not list challenges.', details: String(error?.message || error) });
    }
  }

  if (req.method === 'POST') {
    try {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      const items = normalizeChallengeItems(payload.items);
      const done = normalizeDoneMap(payload.done, items);
      const state = { items, done };
      await writeChallenges(state);
      return json(res, 200, { ok: true, ...state });
    } catch (error) {
      return json(res, 500, { error: 'Could not save challenges.', details: String(error?.message || error) });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return json(res, 405, { error: 'Method not allowed.' });
}
