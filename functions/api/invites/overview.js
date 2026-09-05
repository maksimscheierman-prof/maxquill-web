import { requireOwner } from "../../_lib/auth.mjs";
import { readerService } from "../../_lib/context.mjs";
import { errorResponse, json, methodNotAllowed } from "../../_lib/errors.mjs";

export const onRequest = async (context) => {
  try {
    if (context.request.method !== "GET") return methodNotAllowed();
    await requireOwner(context.request, context.env);
    const bookId = new URL(context.request.url).searchParams.get("bookId");
    return json(await readerService(context).chapterOverview(bookId));
  } catch (error) { return errorResponse(error); }
};
