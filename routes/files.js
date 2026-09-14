const express = require('express');
const { Readable } = require('stream');
const { isLoggedIn } = require('../middleware/auth');
const { isAllowedPrivateBlobUrl, handleClientBlobUpload } = require('../utils/storage');
const router = express.Router();

// Client upload handler endpoint for browser-direct Blob uploads (files > 4.5 MB)
router.post('/upload-token', isLoggedIn, async (req, res) => {
  await handleClientBlobUpload(req, res);
});

// Private Blob authenticated proxy streaming endpoint
router.get('/open', isLoggedIn, async (req, res, next) => {
  const url = (req.query.url || '').toString();
  if (!process.env.BLOB_READ_WRITE_TOKEN || !isAllowedPrivateBlobUrl(url)) {
    return res.status(404).send('File not found');
  }
  try {
    const upstream = await fetch(url, {
      headers: { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` }
    });
    if (!upstream.ok || !upstream.body) {
      return res.status(upstream.status || 404).send('File not found');
    }
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    const disposition = upstream.headers.get('content-disposition');
    if (disposition) res.setHeader('Content-Disposition', disposition);
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
