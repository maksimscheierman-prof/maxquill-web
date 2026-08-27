import { requireWorker } from "../../_lib/auth.mjs";
import { service } from "../../_lib/context.mjs";
import { json } from "../../_lib/errors.mjs";
import { route } from "../../_lib/route.mjs";
export const onRequest = route("GET", async (context) => { await requireWorker(context.request, context.env); return json({ job: await service(context).next() }); });
