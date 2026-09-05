import { readerService } from "../../../_lib/context.mjs";
import { errorResponse, json, methodNotAllowed } from "../../../_lib/errors.mjs";
import { readJson } from "../../../_lib/request.mjs";

export const onRequest = async (context) => {
  try {
    if (context.request.method !== "POST") return methodNotAllowed();
    const input = await readJson(context.request);
    return json(await readerService(context).joinInvite(context.params.token, input), 201);
  } catch (error) { return errorResponse(error); }
};
