import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveCredentials } from "../core/credentials.js";
import { saveStoredCredentials, type SecretStore } from "../core/keyring.js";

class MemoryStore implements SecretStore {
  public readonly backend = "macos-keychain" as const;
  public readonly persistent = true as const;
  private readonly values = new Map<string, string>();

  public async get(account: string): Promise<string | undefined> {
    return this.values.get(account);
  }

  public async set(account: string, password: string): Promise<void> {
    this.values.set(account, password);
  }

  public async delete(account: string): Promise<boolean> {
    return this.values.delete(account);
  }
}

test("credential files accept one sid:password line and preserve colons in the password", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sustech-cli-credentials-"));
  const path = join(directory, "credentials.txt");
  try {
    await writeFile(path, "12410000:part:two\n", "utf8");
    const credentials = await resolveCredentials(path);
    assert.deepEqual(credentials, {
      sid: "12410000",
      password: "part:two",
      source: "file",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("credential files reject multiple lines", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sustech-cli-credentials-"));
  const path = join(directory, "credentials.txt");
  try {
    await writeFile(path, "12410000:first\n12410001:second\n", "utf8");
    await assert.rejects(resolveCredentials(path), /exactly one sid:password line/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("credential resolution preserves explicit automation overrides before keyring", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sustech-cli-credentials-precedence-"));
  const path = join(directory, "credentials.txt");
  const store = new MemoryStore();
  try {
    await writeFile(path, "file-sid:file-password\n", "utf8");
    await saveStoredCredentials({ sid: "keyring-sid", password: "keyring-password" }, { configDir: directory, store });

    const explicitFile = await resolveCredentials({
      credentialsFile: path,
      env: { SUSTECH_SID: "env-sid", SUSTECH_PASSWORD: "env-password" },
      store: { configDir: directory, store },
    });
    assert.equal(explicitFile.source, "file");
    assert.equal(explicitFile.sid, "file-sid");

    const environment = await resolveCredentials({
      env: { SUSTECH_SID: "env-sid", SUSTECH_PASSWORD: "env-password" },
      store: { configDir: directory, store },
    });
    assert.deepEqual(environment, { sid: "env-sid", password: "env-password", source: "environment" });

    const keyring = await resolveCredentials({
      env: {},
      store: { configDir: directory, store },
    });
    assert.deepEqual(keyring, {
      sid: "keyring-sid",
      password: "keyring-password",
      source: "system-keyring",
      profile: "default",
      backend: "macos-keychain",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
