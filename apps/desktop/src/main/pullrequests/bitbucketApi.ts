import { z } from "zod";
import type { BitbucketCredentials } from "../credentials/store.ts";
import { AppFailure } from "../errors.ts";

export const BITBUCKET_API = "https://api.bitbucket.org/2.0";
const TIMEOUT_MS = 30_000;
/** Pages read per list at most; a longer list is cut and marked truncated. */
export const MAX_PAGES = 10;

export interface BitbucketApiDeps {
  fetch: typeof fetch;
  /** The saved credentials, or `undefined` when none are saved. */
  credentials: () => BitbucketCredentials | undefined;
  timeoutMs?: number;
}

/** Bitbucket Cloud's REST API over HTTPS (ADR 0019). Paths start with `/` after `/2.0`. */
export interface BitbucketApi {
  get<T>(path: string, schema: z.ZodType<T>): Promise<T>;
  /** Every page of a paginated list, up to `MAX_PAGES`. */
  list<T>(path: string, item: z.ZodType<T>): Promise<{ values: T[]; truncated: boolean }>;
  /**
   * A write. A timeout, or an answer that cannot be read, may mean it was done anyway:
   * that fails with `post_uncertain`.
   */
  post<T>(path: string, body: unknown | undefined, schema: z.ZodType<T>): Promise<T>;
}

/** One path segment (workspace, repository, branch) for a URL. */
export const segment = (value: string): string => encodeURIComponent(value);

const ErrorBody = z.object({ error: z.object({ message: z.string() }) });

/** A `next` link must stay on the API: never send the credentials anywhere else. */
function checkedNext(next: string): string {
  let url: URL;
  try {
    url = new URL(next);
  } catch {
    throw new AppFailure("bitbucket_failed", "Bitbucket returned an unexpected page link");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "api.bitbucket.org" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    !url.pathname.startsWith("/2.0/")
  ) {
    throw new AppFailure("bitbucket_failed", "Bitbucket returned an unexpected page link");
  }
  return url.href;
}

const Page = <T>(item: z.ZodType<T>) =>
  z.object({ values: z.array(item), next: z.string().optional() });

export function createBitbucketApi(deps: BitbucketApiDeps): BitbucketApi {
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;

  function authorization(): string {
    const credentials = deps.credentials();
    if (!credentials) {
      throw new AppFailure(
        "bitbucket_not_configured",
        "Add your Bitbucket email and API token in Settings.",
      );
    }
    const pair = `${credentials.email}:${credentials.token}`;
    return `Basic ${Buffer.from(pair, "utf8").toString("base64")}`;
  }

  async function failure(response: Response): Promise<AppFailure> {
    let detail = "";
    try {
      const parsed = ErrorBody.safeParse(await response.json());
      if (parsed.success) detail = `: ${parsed.data.error.message}`;
    } catch {
      // No JSON body.
    }
    switch (response.status) {
      case 401:
        return new AppFailure(
          "bitbucket_auth_failed",
          "Bitbucket refused the email and API token. Check them in Settings.",
        );
      case 403:
        return new AppFailure(
          "bitbucket_auth_failed",
          `Bitbucket denied access${detail}. Check that the API token has the pull request and repository scopes.`,
        );
      case 404:
        return new AppFailure(
          "bitbucket_failed",
          "Bitbucket did not find it, or this account has no access to it.",
        );
      case 429: {
        const wait = Number(response.headers.get("retry-after"));
        const when = Number.isFinite(wait) && wait > 0 ? ` in ${Math.ceil(wait)} s` : " later";
        return new AppFailure(
          "bitbucket_rate_limited",
          `Bitbucket's rate limit was reached. Try again${when}.`,
        );
      }
      default:
        return new AppFailure("bitbucket_failed", `Bitbucket answered ${response.status}${detail}`);
    }
  }

  async function request(
    url: string,
    init: { method: "GET" | "POST"; body?: string },
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: authorization(),
      Accept: "application/json",
    };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    try {
      return await deps.fetch(url, {
        method: init.method,
        headers,
        ...(init.body === undefined ? {} : { body: init.body }),
        // Never follow a redirect: it could carry the credentials to another host.
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "TimeoutError";
      if (timedOut && init.method === "POST") {
        throw new AppFailure(
          "post_uncertain",
          "Bitbucket did not answer in time; the comment may have been posted. Check the pull request before posting again.",
        );
      }
      throw new AppFailure(
        "bitbucket_unreachable",
        timedOut ? "Bitbucket did not answer in time." : "Could not reach Bitbucket.",
      );
    }
  }

  async function read<T>(url: string, schema: z.ZodType<T>): Promise<T> {
    const response = await request(url, { method: "GET" });
    if (!response.ok) throw await failure(response);
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new AppFailure("bitbucket_failed", "Bitbucket returned an unexpected answer");
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new AppFailure("bitbucket_failed", "Bitbucket returned an unexpected answer");
    }
    return parsed.data;
  }

  return {
    get: (path, schema) => read(`${BITBUCKET_API}${path}`, schema),

    async list(path, item) {
      const values: z.infer<typeof item>[] = [];
      let url: string | undefined = `${BITBUCKET_API}${path}`;
      for (let page = 0; page < MAX_PAGES && url !== undefined; page++) {
        const answer: { values: z.infer<typeof item>[]; next?: string | undefined } = await read(
          url,
          Page(item),
        );
        values.push(...answer.values);
        url = answer.next === undefined ? undefined : checkedNext(answer.next);
      }
      return { values, truncated: url !== undefined };
    },

    async post(path, body, schema) {
      const response = await request(`${BITBUCKET_API}${path}`, {
        method: "POST",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) throw await failure(response);
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        json = undefined;
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        // Bitbucket accepted it but the answer is unreadable: it probably exists.
        throw new AppFailure(
          "post_uncertain",
          "Bitbucket did not confirm the comment. Check the pull request before posting again.",
        );
      }
      return parsed.data;
    },
  };
}
