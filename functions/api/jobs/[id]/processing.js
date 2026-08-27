import { requireWorker } from "../../../_lib/auth.mjs";
import { service } from "../../../_lib/context.mjs";
import { json } from "../../../_lib/errors.mjs";
import { readJson, requireExactFields } from "../../../_lib/request.mjs";
import { route } from "../../../_lib/route.mjs";
export const onRequest = route("POST", async (context) => { await requireWorker(context.request, context.env); const input = requireExactFields(await readJson(context.request), ["workerId"]); return json(await service(context).processing(context.params.id, input)); });
