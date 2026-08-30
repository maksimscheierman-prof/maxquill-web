import { requireOwner, requireWorker } from "../../../_lib/auth.mjs";
import { service } from "../../../_lib/context.mjs";
import { errorResponse, json, methodNotAllowed } from "../../../_lib/errors.mjs";
import { readJson, requireExactFields } from "../../../_lib/request.mjs";

export const onRequest = async (context) => {
  try {
    if (context.request.method === "GET") { await requireOwner(context.request, context.env); return json(await service(context).resultPackage(context.params.id)); }
    if (context.request.method === "POST") { await requireWorker(context.request, context.env); const input = requireExactFields(await readJson(context.request), ["workerId", "reviewReadyPackage"]); return json(await service(context).result(context.params.id, input)); }
    return methodNotAllowed();
  } catch (error) { return errorResponse(error); }
};
