const status = document.querySelector('#downloadStatus');
const save = document.querySelector('#saveFile');
const retry = document.querySelector('#retryDownload');
let blobUrl;
async function checkedFetch(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    if (response.status === 401) throw new Error('Please return to the workshop and sign in again, then reopen this resource.');
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'The download could not finish. Please try again.');
  }
  return response;
}
async function download() {
  retry.hidden = true;
  save.hidden = true;
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  status.textContent = 'Preparing your file...';
  try {
    const path = window.location.pathname;
    const info = await (await checkedFetch(`${path}?info=1`)).json();
    const chunks = [];
    let received = 0;
    for (let part = 0; received < info.size; part++) {
      const response = await checkedFetch(`${path}?part=${part}&version=${encodeURIComponent(info.version)}`);
      const chunk = await response.arrayBuffer();
      if (!chunk.byteLength || chunk.byteLength !== Math.min(2 * 1024 * 1024, info.size - received)) throw new Error('The file could not be downloaded completely. Please try again.');
      chunks.push(chunk);
      received += chunk.byteLength;
      status.textContent = `Preparing ${info.name}: ${Math.round(received / info.size * 100)}%`;
    }
    blobUrl = URL.createObjectURL(new Blob(chunks, { type: info.type }));
    save.href = blobUrl;
    save.download = info.name;
    save.hidden = false;
    status.textContent = `${info.name} is ready. Select Save file to download it.`;
    save.focus();
  } catch (error) {
    status.textContent = error.message;
    retry.hidden = false;
  }
}
retry.addEventListener('click', download);
window.addEventListener('pagehide', () => { if (blobUrl) URL.revokeObjectURL(blobUrl); });
await download();
