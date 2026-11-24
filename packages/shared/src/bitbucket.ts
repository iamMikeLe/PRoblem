import { z } from "zod";

/**
 * Bitbucket Cloud credentials (ADR 0019): an Atlassian account email and an API token with the
 * pull request scopes. The token goes from the Settings form to the main process once and never
 * comes back: the renderer only ever sees this status.
 */
export const BitbucketStatusSchema = z.object({
  configured: z.boolean(),
  /** The Atlassian account the token belongs to. */
  email: z.string().nullable(),
});
export type BitbucketStatus = z.infer<typeof BitbucketStatusSchema>;

export const SaveBitbucketCredentialsSchema = z.strictObject({
  email: z.email("Enter the email of your Atlassian account.").max(254),
  // Printable ASCII without spaces: a token goes into an HTTP header and nothing else fits.
  token: z
    .string()
    .trim()
    .min(1, "Paste an API token.")
    .max(512, "This is longer than an Atlassian API token.")
    .regex(/^[\x21-\x7E]+$/, "An API token has no spaces or special characters."),
});
export type SaveBitbucketCredentials = z.infer<typeof SaveBitbucketCredentialsSchema>;

/** The answer of "Test connection". */
export const BitbucketTestResultSchema = z.object({ ok: z.boolean(), message: z.string() });
export type BitbucketTestResult = z.infer<typeof BitbucketTestResultSchema>;
