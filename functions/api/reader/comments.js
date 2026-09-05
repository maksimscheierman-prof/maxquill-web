import { readerSessionToken } from "../../_lib/auth.mjs";
import { readerService } from "../../_lib/context.mjs";
import { errorResponse, json, methodNotAllowed } from "../../_lib/errors.mjs";
import { readJson } from "../../_lib/request.mjs";

export const onRequest = async (context) => {
  try {
    const service = readerService(context);
    const token = readerSessionToken(context.request);
    if (context.request.method === "GET") return json({ comments: await service.listOwnComments(token) });
    if (context.request.method === "POST") {
      const input = await readJson(context.request);
      return json(await service.addComment(token, input), 201);
    }
    return methodNotAllowed();
  } catch (error) { return errorResponse(error); }
};
