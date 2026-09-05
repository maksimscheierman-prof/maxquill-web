import { D1JobStore } from "./store.mjs";
import { ReviewQueueService } from "./service.mjs";
import { D1ReaderStore } from "./reader-store.mjs";
import { ReaderFeedbackService } from "./reader-service.mjs";
import { ApiError } from "./errors.mjs";

export function service(context) {
  if (!context.env.DB) throw new ApiError(500, "BACKEND_NOT_CONFIGURED", "Review backend is not configured.");
  return new ReviewQueueService(new D1JobStore(context.env.DB));
}

export function readerService(context) {
  if (!context.env.DB) throw new ApiError(500, "BACKEND_NOT_CONFIGURED", "Review backend is not configured.");
  return new ReaderFeedbackService(new D1ReaderStore(context.env.DB));
}
