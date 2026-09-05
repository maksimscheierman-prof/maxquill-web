import { requireOwner } from "../../_lib/auth.mjs";
import { readerService } from "../../_lib/context.mjs";
import { errorResponse, json, methodNotAllowed } from "../../_lib/errors.mjs";

export const onRequest = async (context) => {
  try {
    if (context.request.method !== "GET") return methodNotAllowed();
    await requireOwner(context.request, context.env);
    const params = new URL(context.request.url).searchParams;
    return json(await readerService(context).chapterComments({
      bookId: params.get("bookId"),
      chapterId: params.get("chapterId"),
      chapterVersion: Number(params.get("chapterVersion")),
      packageFingerprint: params.get("packageFingerprint"),
      reviewerId: params.get("reviewerId") || undefined,
      status: params.get("status") || undefined
    }));
  } catch (error) { return errorResponse(error); }
};
