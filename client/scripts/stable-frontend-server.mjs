import fs from 'fs';
import http from 'http';
import path from 'path';
import { pipeline } from 'stream';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const preferredDistDir = process.env.FRONTEND_DIST_DIR || path.join(__dirname, 'dist');
const fallbackClientDir = path.resolve(__dirname, '..');
const fallbackDistDir = path.join(fallbackClientDir, 'dist');
const distDir = fs.existsSync(preferredDistDir) ? preferredDistDir : fallbackDistDir;

const HOST = process.env.FRONTEND_HOST || '127.0.0.1';
const PORT = Number(process.env.FRONTEND_PORT || process.env.PORT || 3095);
const BACKEND_HOST = process.env.BACKEND_HOST || process.env.HOST || '127.0.0.1';
const BACKEND_PORT = Number(process.env.BACKEND_PORT || 3080);

const proxyPrefixes = ['/api', '/oauth', '/images'];
const serviceWorkerKillSwitch = `
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      await Promise.all(clients.map((client) => client.navigate(client.url)));
    })(),
  );
});
`.trimStart();

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const sendError = (res, statusCode, message) => {
  if (!res.headersSent) {
    res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  res.end(message);
};

const isProxyRequest = (pathname) => proxyPrefixes.some((prefix) => pathname.startsWith(prefix));

const expectedDisconnectCodes = new Set([
  'ECONNRESET',
  'ERR_STREAM_PREMATURE_CLOSE',
  'ERR_STREAM_UNABLE_TO_PIPE',
]);

const isExpectedDisconnect = (error) => expectedDisconnectCodes.has(error?.code);

const toSafeFilePath = (pathname) => {
  const decoded = decodeURIComponent(pathname);
  const normalized = path
    .normalize(decoded)
    .replace(/^(\.\.[/\\])+/, '')
    .replace(/^[/\\]+/, '');
  return path.join(distDir, normalized);
};

const serveFile = (res, filePath) => {
  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      sendError(res, 404, 'Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Cache-Control':
        ext === '.html' || path.basename(filePath) === 'build-id.json'
          ? 'no-cache, no-store, must-revalidate'
          : 'public, max-age=31536000, immutable',
      'Content-Length': stats.size,
      'Content-Type': contentType,
    });

    const stream = fs.createReadStream(filePath);
    pipeline(stream, res, (streamError) => {
      if (streamError && !res.destroyed) {
        sendError(res, 500, 'Failed to read file');
      }
    });
  });
};

const serveSpa = (req, res, pathname) => {
  if (pathname === '/sw.js') {
    res.writeHead(200, {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Content-Type': 'application/javascript; charset=utf-8',
    });
    res.end(serviceWorkerKillSwitch);
    return;
  }

  if (pathname.startsWith('/workbox-')) {
    sendError(res, 404, 'Not Found');
    return;
  }

  const targetPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = toSafeFilePath(targetPath);

  fs.stat(filePath, (error, stats) => {
    if (!error && stats.isFile()) {
      serveFile(res, filePath);
      return;
    }

    serveFile(res, path.join(distDir, 'index.html'));
  });
};

const serveVersion = (res) => {
  const versionPath = path.join(distDir, 'build-id.json');
  fs.readFile(versionPath, 'utf8', (error, content) => {
    if (error) {
      sendError(res, 404, 'Version unavailable');
      return;
    }
    res.writeHead(200, {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Content-Type': 'application/json; charset=utf-8',
    });
    res.end(content);
  });
};

const proxyRequest = (req, res, pathname) => {
  let proxyResponse;
  let clientDisconnected = false;
  const proxyUpstream = http.request(
    {
      host: BACKEND_HOST,
      port: BACKEND_PORT,
      method: req.method,
      path: req.url,
      headers: {
        ...req.headers,
        host: `${BACKEND_HOST}:${BACKEND_PORT}`,
        connection: 'close',
      },
    },
    (proxyRes) => {
      proxyResponse = proxyRes;
      if (clientDisconnected || res.destroyed || res.writableEnded) {
        proxyRes.destroy();
        return;
      }

      try {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        pipeline(proxyRes, res, (streamError) => {
          if (!streamError || clientDisconnected || isExpectedDisconnect(streamError)) {
            return;
          }
          console.error('[stable-frontend] response proxy error', pathname, streamError);
          if (!res.destroyed) {
            res.destroy(streamError);
          }
        });
      } catch (error) {
        proxyRes.destroy();
        if (clientDisconnected || res.destroyed || isExpectedDisconnect(error)) {
          return;
        }
        console.error('[stable-frontend] failed to start response proxy', pathname, error);
        if (!res.headersSent) {
          sendError(res, 502, 'Bad Gateway');
        } else if (!res.destroyed) {
          res.destroy(error);
        }
      }
    },
  );

  res.once('close', () => {
    if (res.writableEnded) {
      return;
    }
    clientDisconnected = true;
    proxyResponse?.destroy();
    proxyUpstream.destroy();
  });

  proxyUpstream.on('error', (error) => {
    if (clientDisconnected) {
      return;
    }
    if (isExpectedDisconnect(error)) {
      if (!res.headersSent) {
        sendError(res, 502, 'Bad Gateway');
      } else if (!res.destroyed) {
        res.destroy();
      }
      return;
    }
    console.error('[stable-frontend] proxy error', pathname, error);
    if (!res.headersSent) {
      sendError(res, 502, 'Bad Gateway');
      return;
    }
    res.destroy(error);
  });

  try {
    pipeline(req, proxyUpstream, (streamError) => {
      if (
        streamError &&
        !clientDisconnected &&
        !isExpectedDisconnect(streamError) &&
        !proxyUpstream.destroyed
      ) {
        proxyUpstream.destroy(streamError);
      }
    });
  } catch (error) {
    if (!clientDisconnected && !isExpectedDisconnect(error) && !proxyUpstream.destroyed) {
      proxyUpstream.destroy(error);
    }
  }
};

const server = http.createServer((req, res) => {
  if (!req.url) {
    sendError(res, 400, 'Missing URL');
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  const pathname = url.pathname;

  if (pathname === '/__sansuo_version') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendError(res, 405, 'Method Not Allowed');
      return;
    }
    serveVersion(res);
    return;
  }

  if (isProxyRequest(pathname)) {
    proxyRequest(req, res, pathname);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendError(res, 405, 'Method Not Allowed');
    return;
  }

  serveSpa(req, res, pathname);
});

server.on('clientError', (error, socket) => {
  if (isExpectedDisconnect(error)) {
    socket.destroy();
    return;
  }
  console.error('[stable-frontend] client error', error);
  if (socket.writable) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  } else {
    socket.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log(
    `[stable-frontend] serving ${distDir} on http://${HOST}:${PORT} with proxy to http://${BACKEND_HOST}:${BACKEND_PORT}`,
  );
});
