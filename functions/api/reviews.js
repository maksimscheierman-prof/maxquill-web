import { requireOwner } from "../_lib/auth.mjs";
import { service } from "../_lib/context.mjs";
import { json } from "../_lib/errors.mjs";
import { readJson } from "../_lib/request.mjs";
import { route } from "../_lib/route.mjs";
export const onRequest = route("POST", async (context) => { await requireOwner(context.request, context.env); const result = await service(context).submit(await readJson(context.request), context.request.headers.get("x-maxquill-package-fingerprint")); return json(result.job, result.created ? 201 : 200); });
