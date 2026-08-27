import { ApiError } from "./errors.mjs";
export const MAX_BODY_BYTES = 262144;
export async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  if (!(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) throw new ApiError(400, "INVALID_CONTENT_TYPE", "Content-Type must be application/json.");
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
  const body = await request.arrayBuffer();
  if (body.byteLength > maxBytes) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
  try { return JSON.parse(new TextDecoder().decode(body)); } catch { throw new ApiError(400, "INVALID_JSON", "Request body must contain valid JSON."); }
}
export function requireExactFields(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !fields.includes(key)) || fields.some((key) => !Object.hasOwn(value, key))) throw new ApiError(400, "INVALID_INPUT", "Request fields are invalid.");
  return value;
}
