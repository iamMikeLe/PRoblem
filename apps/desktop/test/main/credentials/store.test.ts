import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type CredentialStore,
  createCredentialStore,
  type SecretBox,
} from "../../../src/main/credentials/store.ts";
import { openDatabase } from "../../../src/main/db/database.ts";

/** A reversible stand-in for the keychain: the stored bytes never contain the token as is. */
function fakeSecrets(available = true): SecretBox & { failDecrypt: boolean } {
  const box = {
    failDecrypt: false,
    available: () => available,
    encrypt: (text: string) => new TextEncoder().encode([...text].reverse().join("")),
    decrypt: (data: Uint8Array) => {
      if (box.failDecrypt) throw new Error("keychain changed");
      return [...new TextDecoder().decode(data)].reverse().join("");
    },
  };
  return box;
}

const TOKEN = "ATATT3xFfGF0-token";

describe("credential store", () => {
  let db: DatabaseSync;
  let secrets: ReturnType<typeof fakeSecrets>;
  let store: CredentialStore;

  beforeEach(() => {
    db = openDatabase(":memory:");
    secrets = fakeSecrets();
    store = createCredentialStore({ db, secrets, now: () => new Date("2026-11-20T10:00:00Z") });
  });
  afterEach(() => db.close());

  it("saves, replaces and removes Bitbucket credentials", () => {
    expect(store.status()).toEqual({ configured: false, email: null });
    expect(store.bitbucket()).toBeUndefined();

    expect(store.save({ email: "me@example.com", token: TOKEN })).toEqual({
      configured: true,
      email: "me@example.com",
    });
    expect(store.bitbucket()).toEqual({ email: "me@example.com", token: TOKEN });

    store.save({ email: "other@example.com", token: "second" });
    expect(store.bitbucket()).toEqual({ email: "other@example.com", token: "second" });

    expect(store.remove()).toEqual({ configured: false, email: null });
    expect(store.bitbucket()).toBeUndefined();
  });

  it("stores only the encrypted token", () => {
    store.save({ email: "me@example.com", token: TOKEN });
    const raw = JSON.stringify(
      db.prepare("SELECT * FROM credentials").all(),
      (_key, value: unknown) =>
        value instanceof Uint8Array ? new TextDecoder().decode(value) : value,
    );
    expect(raw).not.toContain(TOKEN);
  });

  it("refuses to save without a keychain", () => {
    store = createCredentialStore({ db, secrets: fakeSecrets(false) });
    expect(() => store.save({ email: "me@example.com", token: TOKEN })).toThrow(
      expect.objectContaining({ code: "secret_storage_unavailable" }),
    );
    expect(store.status().configured).toBe(false);
  });

  it("asks to save again when the token cannot be decrypted", () => {
    store.save({ email: "me@example.com", token: TOKEN });
    secrets.failDecrypt = true;
    expect(() => store.bitbucket()).toThrow(
      expect.objectContaining({ code: "secret_storage_unavailable" }),
    );
    // The status still shows the account, so the user knows what to replace.
    expect(store.status()).toEqual({ configured: true, email: "me@example.com" });
  });
});
