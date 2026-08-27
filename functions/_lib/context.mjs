import { D1JobStore } from "./store.mjs";
import { ReviewQueueService } from "./service.mjs";
import { ApiError } from "./errors.mjs";
export function service(context) { if (!context.env.DB) throw new ApiError(500, "BACKEND_NOT_CONFIGURED", "Review backend is not configured."); return new ReviewQueueService(new D1JobStore(context.env.DB)); }
