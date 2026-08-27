export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export function json(data, status = 200) { return Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }); }
export function errorResponse(error) {
  if (error instanceof ApiError) return json({ error: { code: error.code, message: error.message } }, error.status);
  console.error("MaxQuill API request failed without request body details.");
  return json({ error: { code: "INTERNAL_ERROR", message: "The request could not be completed." } }, 500);
}
export function methodNotAllowed() { return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } }, 405); }
