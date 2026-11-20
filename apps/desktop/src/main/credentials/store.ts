import type { DatabaseSync } from "node:sqlite";
import type { BitbucketStatus, SaveBitbucketCredentials } from "@problem/shared";
import { z } from "zod";
import { AppFailure } from "../errors.ts";

/**
 * Encryption with the OS keychain (Electron `safeStorage`), injected so this module stays
 * Electron-free. `available()` is false when only a plain-text fallback exists.
 */
export interface SecretBox {
  available(): boolean;
  encrypt(text: string): Uint8Array;
  decrypt(data: Uint8Array): string;
}

export interface BitbucketCredentials {
  email: string;
  token: string;
}

/** Saved git host credentials (ADR 0019). Only the main process ever sees a token. */
export interface CredentialStore {
  status(): BitbucketStatus;
  save(request: SaveBitbucketCredentials): BitbucketStatus;
  remove(): BitbucketStatus;
  /** The decrypted credentials for API calls, or `undefined` when none are saved. */
  bitbucket(): BitbucketCredentials | undefined;
}

const HOST = "bitbucket";
const Row = z.object({ account: z.string(), secret: z.instanceof(Uint8Array) });

export function createCredentialStore(deps: {
  db: DatabaseSync;
  secrets: SecretBox;
  now?: () => Date;
}): CredentialStore {
  const { db, secrets } = deps;
  const now = deps.now ?? (() => new Date());

  function row() {
    const found = db.prepare("SELECT account, secret FROM credentials WHERE host = ?").get(HOST);
    return found === undefined ? undefined : Row.parse(found);
  }

  function status(): BitbucketStatus {
    const saved = row();
    return { configured: saved !== undefined, email: saved?.account ?? null };
  }

  return {
    status,

    save({ email, token }) {
      if (!secrets.available()) {
        throw new AppFailure(
          "secret_storage_unavailable",
          "This system has no keychain to encrypt the token with, so it cannot be saved.",
        );
      }
      db.prepare(
        `INSERT INTO credentials (host, account, secret, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (host) DO UPDATE SET account = excluded.account, secret = excluded.secret,
           updated_at = excluded.updated_at`,
      ).run(HOST, email, secrets.encrypt(token), now().toISOString());
      return status();
    },

    remove() {
      db.prepare("DELETE FROM credentials WHERE host = ?").run(HOST);
      return status();
    },

    bitbucket() {
      const saved = row();
      if (!saved) return undefined;
      let token: string;
      try {
        token = secrets.decrypt(saved.secret);
      } catch {
        throw new AppFailure(
          "secret_storage_unavailable",
          "The saved Bitbucket token could not be decrypted. Save it again in Settings.",
        );
      }
      return { email: saved.account, token };
    },
  };
}
