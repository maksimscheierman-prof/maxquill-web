import { requireOwner } from "../_lib/auth.mjs";
import { readerService } from "../_lib/context.mjs";
import { errorResponse, json, methodNotAllowed } from "../_lib/errors.mjs";
import { readJson } from "../_lib/request.mjs";

export const onRequest = async (context) => {
  try {
    await requireOwner(context.request, context.env);
    const service = readerService(context);
    if (context.request.method === "GET") {
      const bookId = new URL(context.request.url).searchParams.get("bookId");
      return json({ invites: await service.listInvites(bookId) });
    }
    if (context.request.method === "POST") {
      const input = await readJson(context.request);
      return json(await service.createInvite(input), 201);
    }
    return methodNotAllowed();
  } catch (error) { return errorResponse(error); }
};
