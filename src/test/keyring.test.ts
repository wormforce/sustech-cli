import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CliError } from "../core/errors.js";
import {
  deleteStoredBlackboardCalendarLink,
  deleteStoredCredentials,
  getCredentialBackendStatus,
  getCredentialStatus,
  loadStoredBlackboardCalendarLink,
  loadStoredCredentials,
  saveStoredBlackboardCalendarLink,
  saveStoredCredentials,
  type SecretStore,
} from "../core/keyring.js";

class MemoryStore implements SecretStore {
  public readonly backend = "macos-keychain" as const;
  public readonly persistent = true as const;
  public readonly values = new Map<string, string>();

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

test("system credential profiles keep only non-secret metadata on disk", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "sustech-cli-keyring-"));
  const store = new MemoryStore();
  try {
    const saved = await saveStoredCredentials({
      profile: "personal",
      sid: "12410000",
      password: "part:two secret",
    }, { configDir, store });
    assert.equal(saved.backend, "macos-keychain");
    assert.equal(saved.maskedSid, "12****00");

    const configPath = join(configDir, "credentials.json");
    const metadata = await readFile(configPath, "utf8");
    assert.doesNotMatch(metadata, /part:two secret/);
    assert.doesNotMatch(metadata, /defaultProfile/);
    if (process.platform !== "win32") assert.equal((await stat(configPath)).mode & 0o777, 0o600);

    const loaded = await loadStoredCredentials("personal", { configDir, store });
    assert.deepEqual(loaded, {
      sid: "12410000",
      password: "part:two secret",
      profile: "personal",
      backend: "macos-keychain",
    });

    const status = await getCredentialStatus("personal", { configDir, store });
    assert.equal(status.configured, true);
    assert.equal(status.credentialAvailable, true);
    assert.equal(status.maskedSid, "12****00");
    assert.deepEqual(status.profiles, ["personal"]);

    const deleted = await deleteStoredCredentials("personal", { configDir, store });
    assert.equal(deleted.removed, true);
    assert.equal(store.values.size, 0);
    assert.equal((await getCredentialStatus("personal", { configDir, store })).configured, false);
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
});

test("saving a named profile never changes the implicit default profile", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "sustech-cli-keyring-default-"));
  const store = new MemoryStore();
  try {
    await saveStoredCredentials({ profile: "default", sid: "12410000", password: "first" }, { configDir, store });
    await saveStoredCredentials({ profile: "other", sid: "12410001", password: "second" }, { configDir, store });

    const loaded = await loadStoredCredentials(undefined, { configDir, store, env: {} });
    assert.equal(loaded.profile, "default");
    assert.equal(loaded.password, "first");
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
});

test("Blackboard calendar links are stored by profile without on-disk metadata", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "sustech-cli-bb-calendar-keyring-"));
  const store = new MemoryStore();
  const url = "https://bb.sustech.edu.cn/webapps/calendar/calendarFeed/token-123/learn.ics";
  try {
    const saved = await saveStoredBlackboardCalendarLink({ profile: "personal", url }, { configDir, store });
    assert.equal(saved.profile, "personal");
    assert.equal(saved.backend, "macos-keychain");

    await assert.rejects(readFile(join(configDir, "credentials.json"), "utf8"), (error: unknown) => {
      assert.equal((error as NodeJS.ErrnoException).code, "ENOENT");
      return true;
    });

    const loaded = await loadStoredBlackboardCalendarLink("personal", { configDir, store });
    assert.deepEqual(loaded, {
      profile: "personal",
      url,
      backend: "macos-keychain",
    });

    const deleted = await deleteStoredBlackboardCalendarLink("personal", { configDir, store });
    assert.equal(deleted.removed, true);
    await assert.rejects(
      loadStoredBlackboardCalendarLink("personal", { configDir, store }),
      (error: unknown) => error instanceof CliError && error.code === "BLACKBOARD_CALENDAR_LINK_NOT_FOUND",
    );
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
});

test("logout keeps metadata when credential deletion cannot be verified", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "sustech-cli-keyring-delete-"));
  const store = new MemoryStore();
  try {
    await saveStoredCredentials({ sid: "12410000", password: "secret" }, { configDir, store });
    store.delete = async () => false;

    await assert.rejects(
      deleteStoredCredentials("default", { configDir, store }),
      (error: unknown) => error instanceof CliError && error.code === "CREDENTIAL_STORE_ERROR",
    );
    assert.equal((await getCredentialStatus("default", { configDir, store })).credentialAvailable, true);
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
});

test("logout removes stale metadata when its credential is already missing", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "sustech-cli-keyring-stale-"));
  const store = new MemoryStore();
  try {
    await saveStoredCredentials({ sid: "12410000", password: "secret" }, { configDir, store });
    store.values.clear();

    const deleted = await deleteStoredCredentials("default", { configDir, store });
    assert.equal(deleted.removed, true);
    assert.equal((await getCredentialStatus("default", { configDir, store })).configured, false);
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
});

test("logout restores the credential when metadata cannot be committed", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "sustech-cli-keyring-rollback-"));
  const configPath = join(configDir, "credentials.json");
  const backupPath = join(configDir, "credentials.backup.json");
  const store = new MemoryStore();
  try {
    await saveStoredCredentials({ sid: "12410000", password: "secret" }, { configDir, store });
    const normalDelete = store.delete.bind(store);
    store.delete = async (account: string) => {
      const removed = await normalDelete(account);
      await rename(configPath, backupPath);
      await mkdir(configPath);
      return removed;
    };

    await assert.rejects(
      deleteStoredCredentials("default", { configDir, store }),
      (error: unknown) => error instanceof CliError && error.code === "CREDENTIAL_CONFIG_WRITE_FAILED",
    );
    assert.equal([...store.values.values()][0], "secret");

    await rm(configPath, { recursive: true, force: true });
    await rename(backupPath, configPath);
    assert.equal((await getCredentialStatus("default", { configDir, store })).credentialAvailable, true);
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
});

test("a profile cannot silently switch to another SUSTech account", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "sustech-cli-keyring-account-"));
  const store = new MemoryStore();
  try {
    await saveStoredCredentials({ profile: "default", sid: "12410000", password: "first" }, { configDir, store });
    await assert.rejects(
      saveStoredCredentials({ profile: "default", sid: "12410001", password: "second" }, { configDir, store }),
      (error: unknown) => error instanceof CliError && error.code === "CREDENTIAL_PROFILE_ACCOUNT_MISMATCH",
    );
    assert.equal((await loadStoredCredentials("default", { configDir, store })).password, "first");
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
});

test("invalid credential metadata fails closed instead of being overwritten", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "sustech-cli-keyring-invalid-"));
  const store = new MemoryStore();
  try {
    await writeFile(join(configDir, "credentials.json"), "{not-json}\n", { encoding: "utf8", mode: 0o600 });
    await assert.rejects(
      saveStoredCredentials({ sid: "12410000", password: "secret" }, { configDir, store }),
      (error: unknown) => error instanceof CliError && error.code === "CREDENTIAL_CONFIG_INVALID",
    );
    assert.equal(store.values.size, 0);
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
});

test("headless Linux reports Secret Service unavailable without a keyutils fallback", async () => {
  const headless = await getCredentialBackendStatus({
    platform: "linux",
    env: { PATH: "/usr/bin" },
  });
  assert.equal(headless.backend, "linux-secret-service");
  assert.equal(headless.available, false);
  assert.match(headless.reason ?? "", /D-Bus/);

  const missingTool = await getCredentialBackendStatus({
    platform: "linux",
    env: { PATH: "", DBUS_SESSION_BUS_ADDRESS: "unix:path=/tmp/mock-bus" },
  });
  assert.equal(missingTool.available, false);
  assert.match(missingTool.reason ?? "", /secret-tool/);
  assert.doesNotMatch(missingTool.reason ?? "", /keyutils available/i);
});

test("Linux Secret Service wiring performs store, lookup, and clear through secret-tool", {
  skip: process.platform === "win32",
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "sustech-cli-secret-tool-"));
  const binDir = join(root, "bin");
  const statePath = join(root, "secret-state");
  const logPath = join(root, "secret-log");
  const executable = join(binDir, "secret-tool");
  const fakeEnv: NodeJS.ProcessEnv = {
    PATH: binDir,
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/tmp/sustech-cli-test-bus",
    FAKE_SECRET_STATE: statePath,
    FAKE_SECRET_LOG: logPath,
  };
  const storeOptions = {
    configDir: join(root, "config"),
    platform: "linux" as const,
    env: fakeEnv,
  };
  try {
    await mkdir(binDir);
    await writeFile(executable, `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_SECRET_LOG"
case "$1" in
  store)
    IFS= read -r password
    printf '%s' "$password" > "$FAKE_SECRET_STATE"
    ;;
  lookup)
    if [ -s "$FAKE_SECRET_STATE" ]; then
      /bin/cat "$FAKE_SECRET_STATE"
      printf '\\n'
    else
      exit 1
    fi
    ;;
  clear)
    if [ "$FAKE_SECRET_CLEAR_ERROR" = "1" ]; then
      printf 'Secret Service unavailable\\n' >&2
      exit 1
    fi
    if [ -s "$FAKE_SECRET_STATE" ]; then
      : > "$FAKE_SECRET_STATE"
    else
      exit 1
    fi
    ;;
  *)
    printf 'unexpected command\\n' >&2
    exit 2
    ;;
esac
`, { encoding: "utf8", mode: 0o700 });

    await saveStoredCredentials({ sid: "12410000", password: "secret with spaces" }, storeOptions);
    const loaded = await loadStoredCredentials(undefined, storeOptions);
    assert.equal(loaded.password, "secret with spaces");
    assert.equal(loaded.backend, "linux-secret-service");

    fakeEnv.FAKE_SECRET_CLEAR_ERROR = "1";
    await assert.rejects(
      deleteStoredCredentials(undefined, storeOptions),
      (error: unknown) => error instanceof CliError && error.code === "CREDENTIAL_STORE_ERROR",
    );
    delete fakeEnv.FAKE_SECRET_CLEAR_ERROR;
    assert.equal((await getCredentialStatus(undefined, storeOptions)).credentialAvailable, true);
    assert.equal((await deleteStoredCredentials(undefined, storeOptions)).removed, true);

    const log = await readFile(logPath, "utf8");
    assert.match(log, /store .*service cn\.edu\.sustech\.cli\.cas account default:12410000/);
    assert.match(log, /lookup service cn\.edu\.sustech\.cli\.cas account default:12410000/);
    assert.match(log, /clear service cn\.edu\.sustech\.cli\.cas account default:12410000/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
