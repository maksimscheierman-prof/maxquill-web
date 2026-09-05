import { requireOwner } from "../../../_lib/auth.mjs";
import { readerService } from "../../../_lib/context.mjs";
import { errorResponse, json, methodNotAllowed } from "../../../_lib/errors.mjs";

export const onRequest = async (context) => {
  try {
    if (context.request.method !== "POST") return methodNotAllowed();
    await requireOwner(context.request, context.env);
    return json(await readerService(context).resolveComment(context.params.id));
  } catch (error) { return errorResponse(error); }
};
