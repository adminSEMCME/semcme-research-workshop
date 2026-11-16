export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const types = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};
const invalid = message => Object.assign(new Error(message), { status: 400 });

export function decodeResourceFile(file) {
  const encoded = file?.data;
  if (typeof encoded !== 'string' || !encoded.length || encoded.length > Math.ceil(MAX_FILE_BYTES / 3) * 4) throw invalid('Choose a nonempty file no larger than 20 MB. Use a resource link for larger files.');
  if (encoded.length % 4 || /[^A-Za-z0-9+/=]/.test(encoded)) throw invalid('The file could not be read. Please select it again.');
  const data = Buffer.from(encoded, 'base64');
  if (data.toString('base64') !== encoded) throw invalid('The file could not be read. Please select it again.');
  return validateResourceBytes(file.name, data);
}

export function validateResourceBytes(filename, data) {
  const name = String(filename || '').split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180);
  const extension = name.split('.').pop().toLowerCase();
  const type = types[extension];
  if (!type) throw invalid('Choose a PDF, DOCX, PPTX, XLSX, TXT, PNG, or JPG file.');
  if (!data.length || data.length > MAX_FILE_BYTES) throw invalid('Choose a nonempty file no larger than 20 MB.');
  const valid = extension === 'pdf' ? data.subarray(0, 5).toString() === '%PDF-'
    : ['docx', 'pptx', 'xlsx'].includes(extension) ? data.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))
    : extension === 'png' ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : ['jpg', 'jpeg'].includes(extension) ? data[0] === 255 && data[1] === 216 && data[2] === 255
    : !data.includes(0);
  if (!valid) throw invalid('The file contents do not match its extension. Choose the original document.');
  return { name, type, data };
}

export function resourceUrl(item) {
  return item.file_name ? `/api/resources/${item.id}/file` : item.url;
}
