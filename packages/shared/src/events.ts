import { z } from "zod";
import { FindingSchema, ReviewStatusSchema } from "./domain.ts";

/**
 * Events the main process pushes to the renderer on `EVENT_CHANNEL`.
 * The renderer receives events for all reviews, so switching reviews never waits for data.
 */
export const AppEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("review.status"),
    reviewId: z.string(),
    status: ReviewStatusSchema,
  }),
  z.object({
    type: z.literal("review.findings"),
    reviewId: z.string(),
    findings: z.array(FindingSchema),
  }),
]);
export type AppEvent = z.infer<typeof AppEventSchema>;

export function parseAppEvent(value: unknown): AppEvent | undefined {
  const result = AppEventSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
