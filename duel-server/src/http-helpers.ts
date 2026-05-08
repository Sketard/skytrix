import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { MAX_HTTP_BODY_SIZE } from './types.js';

/**
 * HTTP request/response utilities used by the duel-server's HTTP route
 * dispatcher. Pure functions — no module-level state. The internal-API
 * shared secret is passed in by the caller (server.ts holds it as
 * `INTERNAL_API_KEY` from env).
 */

/** Send a JSON response with the given status code. */
export function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

/**
 * Constant-time check of the `x-internal-key` header against the expected
 * shared secret. On mismatch (including missing header), responds 401 and
 * returns false — caller should bail out without further processing.
 */
export function validateInternalAuth(
  req: IncomingMessage,
  res: ServerResponse,
  expectedKey: string,
): boolean {
  const received = req.headers['x-internal-key'];
  const receivedBuf = Buffer.from(String(received ?? ''), 'utf-8');
  const expectedBuf = Buffer.from(expectedKey, 'utf-8');
  if (receivedBuf.length !== expectedBuf.length || !timingSafeEqual(receivedBuf, expectedBuf)) {
    json(res, 401, { code: 'UNAUTHORIZED', error: 'Unauthorized' });
    return false;
  }
  return true;
}

/**
 * Read the request body as a UTF-8 string with a content-length cap +
 * incremental size guard. Rejects with `Error('PAYLOAD_TOO_LARGE')` when the
 * body exceeds `MAX_HTTP_BODY_SIZE`. 10s timeout via `req.destroy()`.
 */
export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const contentLength = parseInt(req.headers['content-length'] ?? '0', 10);
    if (contentLength > MAX_HTTP_BODY_SIZE) {
      reject(new Error('PAYLOAD_TOO_LARGE'));
      return;
    }

    const timeout = setTimeout(() => {
      req.destroy();
      reject(new Error('Request body read timeout'));
    }, 10_000);

    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_HTTP_BODY_SIZE) {
        clearTimeout(timeout);
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks).toString());
    });
    req.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}
