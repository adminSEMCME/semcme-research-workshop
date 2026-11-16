import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

Object.assign(process.env, {
  NODE_ENV: 'test', RWS_DATABASE_URL: 'postgres://test:test@127.0.0.1:1/test',
  GLOBAL_ADMIN_USERNAME: 'test-admin', GLOBAL_ADMIN_PASSWORD: 'test-password',
  RWS_SESSION_SECRET: 'local-tests-only', COOKIE_SECURE: 'false',
  CONSTANT_CONTACT_ACCESS_TOKEN: 'test-token', CONSTANT_CONTACT_RWS_EVENT_ID: 'old-event',
  CONSTANT_CONTACT_RWS_TRACK_KEY: 'old-track', SMTP_HOST: '',
});
const database = await PGlite.create();
const { pool } = await import('../server/db.js');
const execute = async (sql, params) => {
  if (sql.includes('pg_advisory_')) return { rows: [] };
  if (!params && sql.includes('CREATE TABLE')) return database.exec(sql);
  const result = await database.query(sql, params);
  for (const row of result.rows) if (row.file_data) row.file_data = Buffer.from(row.file_data);
  return result;
};
pool.query = execute;
pool.connect = async () => ({ query: execute, release() {} });
const realFetch = globalThis.fetch;
const registrations = {
  'old-event': [{ email: 'old@example.org', registration_id: 'old-user' }],
  'new-event': [{ email: 'new@example.org', registration_id: 'new-user' }],
};
let ccPaths = [];
globalThis.fetch = async input => {
  const url = new URL(input);
  assert.equal(url.origin, 'https://api.cc.email', 'No live external requests');
  ccPaths.push(url.pathname);
  const match = url.pathname.match(/\/events\/([^/]+)\/tracks\/([^/]+)\/registrations$/);
  if (match && registrations[match[1]] && match[2] !== 'bad-track') return new Response(JSON.stringify({ records: registrations[match[1]] }), { status: 200 });
  const event = url.pathname.match(/\/events\/([^/]+)$/);
  if (event && registrations[event[1]]) return new Response(JSON.stringify({ event_id: event[1], default_track: { track_key: 'default-track' } }), { status: 200 });
  return new Response('{}', { status: 404 });
};
let server;
try {
  const { default: app } = await import('../server/server.js');
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const request = (path, method = 'GET', body, auth = cookie) => realFetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', cookie: auth },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal((await request('/api/admin/registration-settings')).status, 401);
  assert.equal((await request('/api/admin/library/items', 'POST', {})).status, 401);
  assert.equal((await request('/api/admin/registration-settings', 'PUT', {})).status, 401);
  const login = await request('/api/admin/login', 'POST', { username: 'test-admin', password: 'test-password' });
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await (await request('/api/admin/registration-settings')).json()).eventId, 'old-event');
  const section = (await (await request('/api/admin/library/sections', 'POST', { name: 'Test uploads' })).json()).section;
  const { decodeResourceFile, MAX_FILE_BYTES } = await import('../server/resource-files.js');
  const boundary = Buffer.alloc(MAX_FILE_BYTES, 32);
  boundary.write('%PDF-1.4');
  assert.equal(decodeResourceFile({ name: 'large.pdf', data: boundary.toString('base64') }).data.length, MAX_FILE_BYTES);
  const pdf = Buffer.from('%PDF-1.4\nTest resource\n%%EOF');
  const payload = { sectionId: section.id, title: 'Test handout', itemType: 'handout', sourceMode: 'file', file: { name: 'Handout.pdf', data: pdf.toString('base64') } };
  const created = await request('/api/admin/library/items', 'POST', payload);
  assert.equal(created.status, 200, await created.clone().text());
  const id = (await created.json()).item.id;
  let library = await (await request('/api/admin/library')).json();
  assert.equal(library.sections[0].items[0].fileName, 'Handout.pdf');
  assert.equal(JSON.stringify(library).includes(pdf.toString('base64')), false, 'Lists must not return attachment bytes');
  const downloadPath = library.sections[0].items[0].url;
  assert.equal((await request(downloadPath, 'GET', undefined, '')).status, 401);
  let download = await request(downloadPath);
  assert.equal(download.headers.get('content-type'), 'application/pdf');
  assert.match(download.headers.get('content-disposition'), /^attachment/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf);
  assert.equal((await request(`/api/admin/library/items/${id}`, 'PUT', { ...payload, title: 'Edited title', file: null })).status, 200);
  assert.deepEqual(Buffer.from(await (await request(downloadPath)).arrayBuffer()), pdf, 'Metadata edits preserve the file');
  for (const file of [
    { name: 'bad.html', data: Buffer.from('<script>').toString('base64') },
    { name: 'fake.pdf', data: Buffer.from('not a PDF').toString('base64') },
    { name: 'empty.pdf', data: '' },
    { name: 'bad.pdf', data: '$$$$' },
    { name: 'large.pdf', data: Buffer.alloc(3 * 1024 * 1024 + 1).toString('base64') },
  ]) assert.equal((await request(`/api/admin/library/items/${id}`, 'PUT', { ...payload, file })).status, 400);
  assert.deepEqual(Buffer.from(await (await request(downloadPath)).arrayBuffer()), pdf, 'Rejected uploads preserve existing file');
  const { upsertUserFromRegistration, createSession, createMagicLink } = await import('../server/repositories.js');
  const oldUser = await upsertUserFromRegistration({ email: 'old@example.org', eventId: 'old-event', trackKey: 'old-track' });
  const memberCookie = `rws_session=${(await createSession(oldUser.id)).token}`;
  assert.equal((await request(downloadPath, 'GET', undefined, memberCookie)).status, 200);
  await request(`/api/admin/library/items/${id}`, 'PUT', { ...payload, file: null, isVisible: false });
  assert.equal((await request(downloadPath, 'GET', undefined, memberCookie)).status, 404);
  assert.equal((await request(downloadPath)).status, 200, 'Admins can preview hidden files');
  await request(`/api/admin/library/items/${id}`, 'PUT', { ...payload, file: null });
  const settings = { eventId: 'new-event', trackKey: 'new-track', registrationUrl: 'https://example.org/2027-registration' };
  for (const invalid of [{ ...settings, eventId: 'https://wrong.example' }, { ...settings, registrationUrl: 'javascript:alert(1)' }, { ...settings, trackKey: 'bad-track' }]) {
    assert.equal((await request('/api/admin/registration-settings', 'PUT', invalid)).status, 400);
    assert.equal((await (await request('/api/admin/registration-settings')).json()).eventId, 'old-event');
  }
  const oldLink = await createMagicLink(oldUser.id, { ip: '127.0.0.1', get: () => 'test' });
  assert.equal((await request('/api/admin/registration-settings', 'PUT', settings)).status, 200);
  assert.equal((await (await request('/api/public-settings')).json()).registrationUrl, settings.registrationUrl);
  const { getWorkshopSettings, registrationNeedsRecheck } = await import('../server/workshop-settings.js');
  assert.equal(registrationNeedsRecheck(oldUser, await getWorkshopSettings(), 0), true);
  assert.equal((await request('/api/verify-magic-link?token=' + oldLink.token, 'GET', undefined, '')).status, 401, 'Old links cannot bypass campaign switch');
  assert.equal((await request(downloadPath, 'GET', undefined, memberCookie)).status, 401, 'Old users lose file access');
  assert.equal((await request('/api/request-magic-link', 'POST', { email: 'old@example.org' }, '')).status, 403, 'Old registration does not grant new access');
  assert.equal((await request('/api/admin/users/sync', 'POST')).status, 200);
  assert.ok(ccPaths.includes('/v3/events/new-event/tracks/new-track/registrations'));
  const { findUserByEmail } = await import('../server/repositories.js');
  const newUser = await findUserByEmail('new@example.org');
  const newCookie = `rws_session=${(await createSession(newUser.id)).token}`;
  assert.equal((await request('/api/library', 'GET', undefined, newCookie)).status, 200);
  assert.equal((await request(downloadPath, 'GET', undefined, newCookie)).status, 200);
  // Changing tracks on the same event must not reuse the old track cache.
  ccPaths = [];
  assert.equal((await request('/api/admin/registration-settings', 'PUT', { ...settings, trackKey: 'other-track' })).status, 200);
  await request('/api/admin/users/sync', 'POST');
  assert.ok(ccPaths.includes('/v3/events/new-event/tracks/other-track/registrations'));
  assert.equal((await request('/api/admin/registration-settings', 'PUT', { ...settings, trackKey: '' })).status, 200);
  assert.ok(ccPaths.includes('/v3/events/new-event/tracks/default-track/registrations'));
  // Full 20 MB transfers stay below the hosting provider's per-request limit.
  assert.equal((await request('/api/admin/resource-uploads', 'POST', { name: 'large.pdf', totalBytes: MAX_FILE_BYTES }, '')).status, 401);
  assert.equal((await request('/api/admin/resource-uploads', 'POST', { name: 'large.pdf', totalBytes: MAX_FILE_BYTES + 1 })).status, 400);
  const upload = await (await request('/api/admin/resource-uploads', 'POST', { name: 'large.pdf', totalBytes: MAX_FILE_BYTES })).json();
  assert.equal((await request(`/api/admin/library/items/${id}`, 'PUT', { ...payload, file: null, uploadId: upload.id })).status, 400, 'Partial uploads cannot replace a saved file');
  for (let offset = 0; offset < boundary.length; offset += 2 * 1024 * 1024) {
    const part = { offset, data: boundary.subarray(offset, offset + 2 * 1024 * 1024).toString('base64') };
    assert.ok(Buffer.byteLength(JSON.stringify(part)) < 4.5 * 1024 * 1024);
    assert.equal((await request(`/api/admin/resource-uploads/${upload.id}`, 'PUT', part)).status, 200);
    if (offset === 0) assert.equal((await request(`/api/admin/resource-uploads/${upload.id}`, 'PUT', part)).status, 409, 'Duplicate chunks cannot corrupt a file');
  }
  assert.equal((await request(`/api/admin/library/items/${id}`, 'PUT', { ...payload, file: null, uploadId: upload.id })).status, 200);
  assert.equal((await database.query('SELECT id FROM rws_resource_uploads WHERE id=$1', [upload.id])).rows.length, 0, 'Saving consumes temporary upload');
  assert.match((await request(downloadPath)).headers.get('content-type'), /text\/html/);
  const info = await (await request(downloadPath + '?info=1')).json();
  assert.equal(info.size, MAX_FILE_BYTES);
  const downloaded = [];
  for (let part = 0; part < 10; part++) {
    const response = await request(`${downloadPath}?part=${part}&version=${encodeURIComponent(info.version)}`);
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length <= 2 * 1024 * 1024);
    downloaded.push(bytes);
  }
  assert.deepEqual(Buffer.concat(downloaded), boundary, '20 MB PDF downloads byte for byte');
  assert.equal((await request(`${downloadPath}?part=0&version=old`)).status, 409);
  assert.equal((await request(`${downloadPath}?part=10&version=${encodeURIComponent(info.version)}`)).status, 400);
  assert.equal((await request(downloadPath + '?info=1', 'GET', undefined, '')).status, 401);
  assert.equal((await request(`${downloadPath}?part=0&version=${encodeURIComponent(info.version)}`, 'GET', undefined, '')).status, 401);
  const abandoned = await (await request('/api/admin/resource-uploads', 'POST', { name: 'abandoned.pdf', totalBytes: 10 })).json();
  await database.query("UPDATE rws_resource_uploads SET created_at=CURRENT_TIMESTAMP - INTERVAL '2 days' WHERE id=$1", [abandoned.id]);
  const cleanup = await (await request('/api/admin/resource-uploads', 'POST', { name: 'cleanup.pdf', totalBytes: 10 })).json();
  assert.equal((await database.query('SELECT id FROM rws_resource_uploads WHERE id=$1', [abandoned.id])).rows.length, 0);
  await request(`/api/admin/resource-uploads/${cleanup.id}`, 'DELETE');
  // File replacement and switching back to a link remove the old attachment.
  const replacement = Buffer.from('%PDF-1.4\nReplacement\n%%EOF');
  await request(`/api/admin/library/items/${id}`, 'PUT', { ...payload, file: { name: 'New.pdf', data: replacement.toString('base64') } });
  assert.deepEqual(Buffer.from(await (await request(downloadPath)).arrayBuffer()), replacement);
  assert.equal((await request(`/api/admin/library/items/${id}`, 'PUT', { ...payload, sourceMode: 'link', url: 'https://example.org/resource' })).status, 200);
  assert.equal((await request(downloadPath)).status, 404);
  assert.equal((await database.query('SELECT file_data FROM rws_library_items WHERE id=$1', [id])).rows[0].file_data, null);
  await request(`/api/admin/library/items/${id}`, 'PUT', payload);
  await request(`/api/admin/library/items/${id}`, 'DELETE');
  assert.equal((await request(downloadPath)).status, 404);
  const schema = await readFile(new URL('../backend/schema.sql', import.meta.url), 'utf8');
  await database.exec(schema);
  console.log('PASS: admin-only settings/uploads, file validation and persistence, protected downloads, hidden files, replacement/deletion, campaign validation, track changes, old-user access, magic-link revalidation, new-user access, 20 MB chunked uploads/downloads, rejected oversize/incomplete/replayed uploads, expiration cleanup, and repeatable schema.');
  if (process.argv.includes('--preview')) {
    await request('/api/admin/library/items', 'POST', payload);
    console.log(`Local test preview: ${base}/admin (test-admin / test-password)`);
    await new Promise(resolve => process.once('SIGINT', resolve));
  }
} finally {
  globalThis.fetch = realFetch;
  if (server) await new Promise(resolve => server.close(resolve));
  await database.close();
  await pool.end();
}
