// FALCON's server steps share these: JSON in and out, one error shape, nothing secret in an answer or a log.
export class Fail extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code || 'error'; }
}

export function handler(methods, fn) {
  return async (req, res) => {
    try {
      if (!methods.includes(req.method)) throw new Fail(405, 'Method not allowed', 'method');
      const out = await fn(req, res);
      if (!res.headersSent) send(res, 200, out ?? { ok: true });
    } catch (e) {
      const status = e instanceof Fail ? e.status : 500;
      if (status >= 500) console.error('[falcon api] ' + req.url + ': ' + String(e && e.message).slice(0, 200));
      send(res, status, { ok: false, error: e instanceof Fail ? e.message : 'The server could not do it – try again.', code: e instanceof Fail ? e.code : 'server' });
    }
  };
}

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

// The body as an object (Vercel gives it parsed for JSON; the SMS hook needs the raw text – see rawBody).
export function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) { try { return JSON.parse(req.body); } catch { throw new Fail(400, 'The request is not JSON.', 'json'); } }
  return {};
}

// The exact bytes that were sent (a signed hook is checked on them). Read before anything touches req.body.
export async function rawBody(req) {
  if (typeof req.rawBody === 'string') return req.rawBody;
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody.toString('utf8');
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks).toString('utf8');
}

export function bearer(req) {
  const h = String(req.headers.authorization || '');
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) throw new Fail(401, 'Sign in first.', 'signin');
  return m[1].trim();
}
