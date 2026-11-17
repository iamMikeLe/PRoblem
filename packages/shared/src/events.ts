import { z } from "zod";
import { FindingSchema, ReviewStatusSchema } from "./domain.ts";

/**
 * Events pushed from the server to every connected client over `/ws`.
 * Clients receive events for all reviews, so switching reviews never waits on the network.
 */
export const ServerEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), serverTime: z.iso.datetime(), version: z.string() }),
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
export type ServerEvent = z.infer<typeof ServerEventSchema>;

export function parseServerEvent(raw: string): ServerEvent | undefined {
  try {
    const result = ServerEventSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}
