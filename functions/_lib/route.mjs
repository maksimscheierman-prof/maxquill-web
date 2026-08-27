import { errorResponse, methodNotAllowed } from "./errors.mjs";
export function route(method, handler) { return async (context) => { if (context.request.method !== method) return methodNotAllowed(); try { return await handler(context); } catch (error) { return errorResponse(error); } }; }
