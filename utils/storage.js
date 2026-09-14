const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { put, del, handleUpload } = require('@vercel/blob');

function cloudStorageEnabled() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function safeName(name) {
  return String(name || 'upload').replace(/[^a-zA-Z0-9.\-]/g, '_');
}

/**
 * Persists a raw buffer either locally (dev fallback) or to Vercel Blob private
 * storage. Unlike persistUpload(), this doesn't require a Multer file object,
 * so it also works for buffers obtained another way.
 */
async function persistBuffer(buffer, originalName, mimetype, folder = 'uploads') {
  if (!buffer) return null;

  if (!cloudStorageEnabled()) {
    const fsPromises = require('fs/promises');
    const dir = path.join(__dirname, '..', 'public', folder);
    await fsPromises.mkdir(dir, { recursive: true });
    const stored = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${safeName(originalName)}`;
    await fsPromises.writeFile(path.join(dir, stored), buffer);
    return { path: `/${folder}/${stored}`, storageUrl: null };
  }

  const filename = `${folder}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${safeName(originalName)}`;
  const object = await put(filename, buffer, {
    access: 'private',
    contentType: mimetype || undefined,
    addRandomSuffix: true,
    token: process.env.BLOB_READ_WRITE_TOKEN
  });

  return {
    path: `/files/open?url=${encodeURIComponent(object.url)}`,
    storageUrl: object.url
  };
}

/**
 * Persists an uploaded (Multer) file either locally (dev fallback) or to Vercel Blob private storage.
 */
async function persistUpload(file, folder = 'uploads') {
  if (!file) return null;
  if (!cloudStorageEnabled()) {
    if (file.path) {
      const rel = path.relative(path.join(__dirname, '..', 'public'), file.path);
      return { path: '/' + rel.split(path.sep).join('/'), storageUrl: null };
    }
    return null;
  }

  if (!file.buffer) {
    throw new Error('Cloud uploads require Multer memory storage.');
  }

  return persistBuffer(file.buffer, file.originalname, file.mimetype, folder);
}

/**
 * Deletes a Vercel Blob object given its storage URL.
 */
async function deleteStorageObject(storageUrl) {
  if (!storageUrl || !cloudStorageEnabled()) return false;
  try {
    await del(storageUrl, { token: process.env.BLOB_READ_WRITE_TOKEN });
    return true;
  } catch (err) {
    console.error('[Blob Delete Error]', err.message);
    return false;
  }
}

/**
 * Deletes whatever a stored web path (as saved on a model's *Path column) points at —
 * a private Vercel Blob object (proxied through /files/open?url=...) in cloud mode,
 * or a local file under public/ in dev/local-fallback mode. Safe to call with null/undefined.
 */
async function removeUploadedFile(webPath) {
  if (!webPath) return false;

  if (webPath.startsWith('/files/open')) {
    try {
      const parsed = new URL(webPath, 'http://internal');
      const storageUrl = parsed.searchParams.get('url');
      if (storageUrl) return await deleteStorageObject(storageUrl);
    } catch (err) {
      console.error('[removeUploadedFile] Failed to parse blob proxy path', webPath, err.message);
    }
    return false;
  }

  // Local-disk fallback path (dev only) — e.g. /uploads/inventory/foo.jpg
  try {
    const abs = path.join(__dirname, '..', 'public', webPath.replace(/^\//, ''));
    if (fs.existsSync(abs)) {
      fs.unlinkSync(abs);
      return true;
    }
  } catch (err) {
    console.error('[removeUploadedFile] Failed to remove local file', webPath, err.message);
  }
  return false;
}

/**
 * Handles browser-direct client upload authentication tokens for files > 4.5 MB
 */
async function handleClientBlobUpload(req, res) {
  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        // Authenticate request
        if (!req.session || !req.session.user) {
          throw new Error('Unauthorized upload attempt.');
        }
        return {
          allowedContentTypes: [
            'image/jpeg', 'image/png', 'image/webp', 'image/gif',
            'video/mp4', 'video/webm',
            'application/pdf', 'application/octet-stream', 'model/stl',
            'model/step', 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml'
          ],
          tokenPayload: JSON.stringify({ userId: req.session.user.id })
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        console.log('[Blob Upload Completed]', blob.url);
      }
    });
    return res.status(200).json(jsonResponse);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
}

function isAllowedPrivateBlobUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (
      url.hostname.endsWith('.private.blob.vercel-storage.com') ||
      url.hostname.endsWith('.public.blob.vercel-storage.com') ||
      url.hostname.endsWith('.blob.vercel-storage.com')
    );
  } catch {
    return false;
  }
}

module.exports = {
  cloudStorageEnabled,
  persistUpload,
  persistBuffer,
  deleteStorageObject,
  removeUploadedFile,
  handleClientBlobUpload,
  isAllowedPrivateBlobUrl
};
