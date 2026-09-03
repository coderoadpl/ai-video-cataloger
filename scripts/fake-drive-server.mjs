import { Buffer } from 'node:buffer';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { URL } from 'node:url';
import { parseArgs } from 'node:util';

export const FAKE_DRIVE_ID = 'drive-fake-1';
export const FAKE_DRIVE_NAME = 'QA Shared Drive';
export const FAKE_SERVICE_ACCOUNT_EMAIL = 'qa-backup@example.com';

export const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const JSON_HEADERS = { 'content-type': 'application/json; charset=UTF-8' };

export const serviceAccountKeyJson = (tokenUri) => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return JSON.stringify({
    type: 'service_account',
    project_id: 'avc-fake-drive',
    private_key_id: randomUUID(),
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    client_email: FAKE_SERVICE_ACCOUNT_EMAIL,
    client_id: '000000000000000000000',
    token_uri: tokenUri,
  }, null, 2);
};

const readBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
};

const sendJson = (response, status, payload, headers = {}) => {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, { ...JSON_HEADERS, 'content-length': String(body.byteLength), ...headers });
  response.end(body);
};

const quoted = (query, prefix) => {
  const match = new RegExp(`${prefix}='([^']*)'`).exec(query);
  return match === null ? null : match[1];
};

const appPropertyFilters = (query) => {
  const filters = [];
  const pattern = /appProperties has \{ key='([^']*)' and value='([^']*)' \}/g;
  let match = pattern.exec(query);
  while (match !== null) {
    filters.push({ key: match[1], value: match[2] });
    match = pattern.exec(query);
  }
  return filters;
};

const parentFilter = (query) => {
  const match = /'([^']*)' in parents/.exec(query);
  return match === null ? null : match[1];
};

// The destination joins app-property filters with `or` only when it asks for both tiers at once.
const matchesQuery = (file, query) => {
  const parent = parentFilter(query);
  if (parent !== null && !file.parents.includes(parent)) return false;
  const name = quoted(query, 'name');
  if (name !== null && file.name !== name) return false;
  const mimeType = quoted(query, 'mimeType');
  if (mimeType !== null && file.mimeType !== mimeType) return false;
  const filters = appPropertyFilters(query);
  if (filters.length === 0) return true;
  const satisfied = filters.filter((filter) => file.appProperties[filter.key] === filter.value);
  return query.includes(' or ') ? satisfied.length > 0 : satisfied.length === filters.length;
};

const multipartParts = (body, contentType) => {
  const boundary = /boundary=([^;]+)/.exec(contentType ?? '')?.[1];
  if (boundary === undefined) return null;
  const separator = Buffer.from(`--${boundary}`);
  const sections = [];
  let cursor = body.indexOf(separator);
  while (cursor !== -1) {
    const next = body.indexOf(separator, cursor + separator.length);
    if (next === -1) break;
    const section = body.subarray(cursor + separator.length, next);
    const headerEnd = section.indexOf('\r\n\r\n');
    if (headerEnd !== -1) sections.push(section.subarray(headerEnd + 4, section.length - 2));
    cursor = next;
  }
  return sections.length < 2 ? null : { metadata: sections[0], content: sections[1] };
};

export const startFakeDriveServer = async ({ port = 0, host = '127.0.0.1' } = {}) => {
  const files = new Map();
  const sessions = new Map();
  const requests = [];

  const fileMetadata = (file) => ({
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    parents: file.parents,
    driveId: FAKE_DRIVE_ID,
    size: String(file.bytes.byteLength),
    createdTime: file.createdTime,
    appProperties: file.appProperties,
  });

  const storeFile = (metadata, content) => {
    const id = `file-${randomUUID()}`;
    const file = {
      id,
      name: typeof metadata.name === 'string' ? metadata.name : id,
      mimeType: typeof metadata.mimeType === 'string' ? metadata.mimeType : 'application/octet-stream',
      parents: Array.isArray(metadata.parents) ? metadata.parents : [FAKE_DRIVE_ID],
      appProperties: typeof metadata.appProperties === 'object' && metadata.appProperties !== null ? metadata.appProperties : {},
      createdTime: new Date().toISOString(),
      bytes: content,
    };
    files.set(id, file);
    return file;
  };

  const handle = async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${host}`);
    requests.push(`${request.method ?? 'GET'} ${url.pathname}${url.search}`);
    const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
    const method = request.method ?? 'GET';

    if (url.pathname === '/token' && method === 'POST') {
      await readBody(request);
      sendJson(response, 200, { access_token: 'fake-access-token', token_type: 'Bearer', expires_in: 3600 });
      return;
    }

    if (url.pathname === '/reset' && method === 'POST') {
      files.clear();
      sessions.clear();
      sendJson(response, 200, { reset: true });
      return;
    }

    const uploadSession = sessions.get(url.pathname);
    if (uploadSession !== undefined) {
      const body = await readBody(request);
      if (method === 'DELETE') {
        sessions.delete(url.pathname);
        response.writeHead(204);
        response.end();
        return;
      }
      const chunks = Buffer.concat([uploadSession.received, body]);
      if (chunks.byteLength < uploadSession.sizeBytes) {
        sessions.set(url.pathname, { ...uploadSession, received: chunks });
        response.writeHead(308, { range: `bytes=0-${String(chunks.byteLength - 1)}` });
        response.end();
        return;
      }
      sessions.delete(url.pathname);
      const stored = storeFile(uploadSession.metadata, chunks);
      sendJson(response, 200, { id: stored.id, name: stored.name, size: String(stored.bytes.byteLength) });
      return;
    }

    if (segments.includes('upload') && segments.at(-1) === 'files' && method === 'POST') {
      const body = await readBody(request);
      if (url.searchParams.get('uploadType') === 'resumable') {
        const sessionPath = `/upload-session/${randomUUID()}`;
        sessions.set(sessionPath, {
          metadata: JSON.parse(body.toString('utf8')),
          sizeBytes: Number(request.headers['x-upload-content-length'] ?? '0'),
          received: Buffer.alloc(0),
        });
        response.writeHead(200, { location: `http://${host}:${String(boundPort)}${sessionPath}` });
        response.end();
        return;
      }
      const parts = multipartParts(body, request.headers['content-type']);
      if (parts === null) {
        sendJson(response, 400, { error: { message: 'malformed multipart upload' } });
        return;
      }
      const stored = storeFile(JSON.parse(parts.metadata.toString('utf8')), parts.content);
      sendJson(response, 200, { id: stored.id, name: stored.name, size: String(stored.bytes.byteLength) });
      return;
    }

    if (segments.at(-2) === 'drives') {
      sendJson(response, 200, { id: FAKE_DRIVE_ID, name: FAKE_DRIVE_NAME });
      return;
    }

    if (segments.at(-1) === 'permissions') {
      sendJson(response, 200, {
        permissions: [{ emailAddress: FAKE_SERVICE_ACCOUNT_EMAIL, role: 'fileOrganizer', type: 'user' }],
      });
      return;
    }

    if (segments.at(-1) === 'files' && method === 'GET') {
      const query = url.searchParams.get('q') ?? '';
      const matched = [...files.values()]
        .filter((file) => matchesQuery(file, query))
        .sort((left, right) => right.createdTime.localeCompare(left.createdTime))
        .map(fileMetadata);
      sendJson(response, 200, { files: matched });
      return;
    }

    if (segments.at(-1) === 'files' && method === 'POST') {
      const metadata = JSON.parse((await readBody(request)).toString('utf8'));
      const created = storeFile({ ...metadata, mimeType: metadata.mimeType ?? FOLDER_MIME_TYPE }, Buffer.alloc(0));
      sendJson(response, 200, { id: created.id, name: created.name });
      return;
    }

    if (segments.at(-2) === 'files') {
      const file = files.get(segments.at(-1) ?? '');
      if (file === undefined) {
        sendJson(response, 404, { error: { message: 'file not found' } });
        return;
      }
      if (method === 'DELETE') {
        files.delete(file.id);
        response.writeHead(204);
        response.end();
        return;
      }
      if (url.searchParams.get('alt') === 'media') {
        response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(file.bytes.byteLength) });
        response.end(file.bytes);
        return;
      }
      sendJson(response, 200, fileMetadata(file));
      return;
    }

    sendJson(response, 404, { error: { message: `unhandled fake Drive request ${method} ${url.pathname}` } });
  };

  const server = createServer((request, response) => {
    handle(request, response).catch((cause) => {
      sendJson(response, 500, { error: { message: cause instanceof Error ? cause.message : String(cause) } });
    });
  });
  await new Promise((resolve) => server.listen(port, host, resolve));
  const address = server.address();
  const boundPort = typeof address === 'object' && address !== null ? address.port : Number(port);
  const origin = `http://${host}:${String(boundPort)}`;
  return {
    origin,
    port: boundPort,
    driveBaseUrl: `${origin}/drive/v3`,
    uploadBaseUrl: `${origin}/upload/drive/v3`,
    tokenUri: `${origin}/token`,
    requests,
    files,
    close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
  };
};

const main = async () => {
  const { values } = parseArgs({
    options: { port: { type: 'string', default: '0' }, help: { type: 'boolean', default: false } },
  });
  if (values.help) {
    console.log('fake-drive-server — in-memory Google Drive stand-in for the release walkthrough.\n\n'
      + 'Usage:\n  node scripts/fake-drive-server.mjs [--port <port>]\n');
    return;
  }
  const server = await startFakeDriveServer({ port: Number(values.port) });
  console.log(JSON.stringify({
    origin: server.origin,
    driveBaseUrl: server.driveBaseUrl,
    uploadBaseUrl: server.uploadBaseUrl,
    tokenUri: server.tokenUri,
  }));
  process.on('SIGINT', () => {
    void server.close().then(() => process.exit(0));
  });
};

if (import.meta.url === `file://${process.argv[1] ?? ''}`) await main();
