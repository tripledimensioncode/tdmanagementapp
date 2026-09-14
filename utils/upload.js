const path = require('path');
const multer = require('multer');
const { cloudStorageEnabled } = require('./storage');

// Standard maximum payload for function requests
const MAX_FILE_BYTES = 4.5 * 1024 * 1024; // 4.5 MB Vercel Serverless Function limit

const diskStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (file.mimetype.startsWith('image/')) cb(null, path.join(__dirname, '..', 'public', 'uploads', 'images'));
    else if (file.mimetype.startsWith('video/')) cb(null, path.join(__dirname, '..', 'public', 'uploads', 'videos'));
    else cb(null, path.join(__dirname, '..', 'public', 'uploads', 'files'));
  },
  filename: function (req, file, cb) {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-]/g, '_');
    cb(null, unique + '-' + safe);
  }
});

// File-type filter — enforce image restrictions when field name is "image"
function fileFilter(req, file, cb) {
  if (file.fieldname === 'image' && !file.mimetype.startsWith('image/')) {
    return cb(new Error('Only image files are accepted for this field.'), false);
  }
  cb(null, true);
}

const upload = multer({
  storage: cloudStorageEnabled() ? multer.memoryStorage() : diskStorage,
  fileFilter,
  limits: { fileSize: MAX_FILE_BYTES }
});

module.exports = upload;
