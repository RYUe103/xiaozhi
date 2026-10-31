const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const {
  mergeFileConfig,
  getEndpointFileConfig,
  fileConfig: defaultFileConfig,
} = require('librechat-data-provider');
const { getAppConfig } = require('~/server/services/Config');

function decodeUploadOriginalName(originalName) {
  let decoded = String(originalName || '');
  try {
    decoded = decodeURIComponent(decoded);
  } catch (_error) {
    // Keep the original value when it is not percent-encoded.
  }

  const latin1Decoded = Buffer.from(decoded, 'latin1').toString('utf8');
  const hasCjk = /[\u3400-\u9fff]/.test(decoded);
  const latin1HasCjk = /[\u3400-\u9fff]/.test(latin1Decoded);
  if (!hasCjk && latin1HasCjk && !latin1Decoded.includes('\uFFFD')) {
    return latin1Decoded;
  }

  return decoded;
}

function sanitizeUploadFilename(originalName) {
  const rawName = decodeUploadOriginalName(originalName).normalize('NFC');
  const originalExt = path.extname(rawName);
  let filename = path
    .basename(rawName)
    .replace(/[\u0000-\u001f\u007f<>:"\/\\|?*]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');

  if (!filename || filename === '.' || filename === '..' || /^_+$/.test(filename)) {
    const safeExt = originalExt
      .normalize('NFC')
      .replace(/[\u0000-\u001f\u007f<>:"\/\\|?*\s]+/g, '')
      .slice(0, 24);
    filename = `upload${safeExt && safeExt.startsWith('.') ? safeExt : ''}`;
  }

  const maxLength = 180;
  if (filename.length > maxLength) {
    const ext = path.extname(filename);
    const name = filename.slice(0, filename.length - ext.length);
    const keep = Math.max(1, maxLength - ext.length);
    filename = `${name.slice(0, keep)}${ext}`;
  }

  return filename;
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const appConfig = req.config;
    const outputPath = path.join(appConfig.paths.uploads, 'temp', req.user.id);
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
    }
    cb(null, outputPath);
  },
  filename: function (req, file, cb) {
    req.file_id = crypto.randomUUID();
    file.originalname = decodeUploadOriginalName(file.originalname);
    const sanitizedFilename = sanitizeUploadFilename(file.originalname);
    cb(null, sanitizedFilename);
  },
});

const importFileFilter = (req, file, cb) => {
  if (file.mimetype === 'application/json') {
    cb(null, true);
  } else if (path.extname(file.originalname).toLowerCase() === '.json') {
    cb(null, true);
  } else {
    cb(new Error('Only JSON files are allowed'), false);
  }
};

const sansuoSupportedUploadExtensions = new Set([
  '.pdf',
  '.docx',
  '.xlsx',
  '.csv',
  '.txt',
  '.md',
  '.json',
  '.html',
  '.htm',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.heic',
  '.heif',
]);

function isSanSuoSupportedUpload(originalName) {
  const decodedName = decodeUploadOriginalName(originalName);
  const ext = path.extname(decodedName).toLowerCase();
  return sansuoSupportedUploadExtensions.has(ext);
}

/**
 *
 * @param {import('librechat-data-provider').FileConfig | undefined} customFileConfig
 */
const createFileFilter = (customFileConfig) => {
  /**
   * @param {ServerRequest} req
   * @param {Express.Multer.File}
   * @param {import('multer').FileFilterCallback} cb
   */
  const fileFilter = (req, file, cb) => {
    if (!file) {
      return cb(new Error('No file provided'), false);
    }

    if (req.originalUrl.endsWith('/speech/stt') && file.mimetype.startsWith('audio/')) {
      return cb(null, true);
    }

    const endpoint = req.body.endpoint;
    const endpointType = req.body.endpointType;

    if (endpoint === 'SanSuoMain' && !isSanSuoSupportedUpload(file.originalname)) {
      return cb(
        new Error(
          'Unsupported SanSuoMain file type. Supported: pdf, docx, xlsx, csv, txt, md, json, html, images',
        ),
        false,
      );
    }

    const endpointFileConfig = getEndpointFileConfig({
      fileConfig: customFileConfig,
      endpoint,
      endpointType,
    });

    if (!defaultFileConfig.checkType(file.mimetype, endpointFileConfig.supportedMimeTypes)) {
      return cb(new Error('Unsupported file type: ' + file.mimetype), false);
    }

    cb(null, true);
  };

  return fileFilter;
};

const createMulterInstance = async () => {
  const appConfig = await getAppConfig();
  const fileConfig = mergeFileConfig(appConfig?.fileConfig);
  const fileFilter = createFileFilter(fileConfig);
  return multer({
    storage,
    fileFilter,
    limits: { fileSize: fileConfig.serverFileSizeLimit },
  });
};

module.exports = { createMulterInstance, storage, importFileFilter };
