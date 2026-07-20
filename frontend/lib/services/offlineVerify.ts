/**
 * Offline QR proof service (#391).
 *
 * QR codes embed a compact signed payload so the verify page can validate
 * product provenance without any network call.
 *
 * Signing uses HMAC-SHA256 (Web Crypto) with a shared app secret.
 * The payload is base64url-encoded and appended as ?proof=<token> to the
 * verify URL.
 */

export interface QrProofPayload {
  id: string;
  name: string;
  origin: string;
  owner: string;
  ts: number; // registration timestamp
}

const APP_SECRET =
  typeof process !== 'undefined'
    ? (process.env.NEXT_PUBLIC_QR_PROOF_SECRET ?? 'supply-link-qr-default')
    : 'supply-link-qr-default';

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded);
  const buf = new ArrayBuffer(bin.length);
  const arr = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** Encode a payload + HMAC signature into a compact base64url token. */
export async function encodeQrProof(payload: QrProofPayload): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const key = await hmacKey(APP_SECRET);
  const sig = await crypto.subtle.sign('HMAC', key, data);
  // token = base64url(payload) + '.' + base64url(sig)
  return `${b64url(data.buffer as ArrayBuffer)}.${b64url(sig)}`;
}

export interface QrProofResult {
  valid: boolean;
  payload?: QrProofPayload;
  error?: string;
}

/** Decode and verify a QR proof token without any network call. */
export async function verifyQrProof(token: string): Promise<QrProofResult> {
  const dot = token.lastIndexOf('.');
  if (dot === -1) return { valid: false, error: 'Malformed token' };

  const dataPart = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);

  let dataBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    dataBytes = b64urlDecode(dataPart);
    sigBytes = b64urlDecode(sigPart);
  } catch {
    return { valid: false, error: 'Invalid base64url encoding' };
  }

  const key = await hmacKey(APP_SECRET);
  const ok = await crypto.subtle.verify('HMAC', key, sigBytes, dataBytes);
  if (!ok) return { valid: false, error: 'Signature verification failed' };

  try {
    const payload: QrProofPayload = JSON.parse(new TextDecoder().decode(dataBytes));
    return { valid: true, payload };
  } catch {
    return { valid: false, error: 'Invalid payload JSON' };
  }
}
