import { ApiError } from "./errors.mjs";

function decodePart(value) { const normalized = value.replace(/-/g, "+").replace(/_/g, "/"); const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")); return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))); }
function bytes(value) { const normalized = value.replace(/-/g, "+").replace(/_/g, "/"); const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")); return Uint8Array.from(binary, (char) => char.charCodeAt(0)); }

export async function verifyAccessJwt(token, env, fetcher = fetch) {
  if (!token || !env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) return false;
  try {
    const [encodedHeader, encodedPayload, signature] = token.split(".");
    if (!signature) return false;
    const header = decodePart(encodedHeader), payload = decodePart(encodedPayload), issuer = env.CF_ACCESS_TEAM_DOMAIN.replace(/\/$/, "");
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (header.alg !== "RS256" || payload.iss !== issuer || !audiences.includes(env.CF_ACCESS_AUD) || !Number.isFinite(payload.exp) || payload.exp <= Date.now() / 1000) return false;
    const response = await fetcher(`${issuer}/cdn-cgi/access/certs`);
    if (!response.ok) return false;
    const jwk = (await response.json()).keys?.find((key) => key.kid === header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, bytes(signature), new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`));
  } catch { return false; }
}

export async function requireOwner(request, env, verifier = verifyAccessJwt) {
  const token = request.headers.get("cf-access-jwt-assertion") || request.headers.get("CF-Access-Jwt-Assertion");
  if (!(await verifier(token, env))) throw new ApiError(401, "UNAUTHORIZED", "Owner authentication is required.");
}
async function digest(value) { return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))); }
export async function requireWorker(request, env) {
  const expected = env.MAXQUILL_WORKER_TOKEN, supplied = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!expected || !supplied) throw new ApiError(401, "UNAUTHORIZED", "Worker authentication is required.");
  const [left, right] = await Promise.all([digest(expected), digest(supplied)]); let difference = 0; for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  if (difference !== 0) throw new ApiError(403, "FORBIDDEN", "Worker authentication failed.");
}

export function readerSessionToken(request) {
  return (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

export async function requireReaderSession(request, readerService) {
  const token = readerSessionToken(request);
  if (!token) throw new ApiError(401, "UNAUTHORIZED", "Reader session is required.");
  return readerService.resolveSession(token);
}
