import { readerService } from "../../_lib/context.mjs";
import { errorResponse, json, methodNotAllowed } from "../../_lib/errors.mjs";

export const onRequest = async (context) => {
  try {
    if (context.request.method !== "GET") return methodNotAllowed();
    return json(await readerService(context).getInvite(context.params.token));
  } catch (error) { return errorResponse(error); }
};
