import { readerSessionToken } from "../../_lib/auth.mjs";
import { readerService } from "../../_lib/context.mjs";
import { errorResponse, json, methodNotAllowed } from "../../_lib/errors.mjs";

export const onRequest = async (context) => {
  try {
    if (context.request.method !== "POST") return methodNotAllowed();
    return json(await readerService(context).finish(readerSessionToken(context.request)));
  } catch (error) { return errorResponse(error); }
};
