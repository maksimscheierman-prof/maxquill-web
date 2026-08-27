import { requireOwner } from "../../_lib/auth.mjs";
import { service } from "../../_lib/context.mjs";
import { json } from "../../_lib/errors.mjs";
import { route } from "../../_lib/route.mjs";
export const onRequest = route("GET", async (context) => { await requireOwner(context.request, context.env); return json(await service(context).status(context.params.id)); });
