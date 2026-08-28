import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { CliError } from "./errors.js";
import { defaultConfigDirectory } from "./local-store.js";

export const DEFAULT_CREDENTIAL_PROFILE = "default";
export const SUSTECH_CREDENTIAL_SERVICE = "cn.edu.sustech.cli.cas";
export const BLACKBOARD_CALENDAR_LINK_SERVICE = "cn.edu.sustech.cli.bb-calendar-link";

export type CredentialBackend =
  | "macos-keychain"
  | "windows-credential-manager"
  | "linux-secret-service";

export interface SecretStore {
  readonly backend: CredentialBackend;
  readonly persistent: true;
  get(account: string): Promise<string | undefined>;
  set(account: string, password: string): Promise<void>;
  delete(account: string): Promise<boolean>;
}

export interface CredentialStoreOptions {
  configDir?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  store?: SecretStore;
}

interface StoredProfile {
  sid: string;
  account: string;
  backend: CredentialBackend;
  storedAt: string;
}

interface CredentialConfig {
  schemaVersion: "1";
  profiles: Record<string, StoredProfile>;
}

export interface CredentialBackendStatus {
  backend: CredentialBackend | "unavailable";
  available: boolean;
  persistent: boolean;
  reason?: string;
  remediation?: string;
}

export interface CredentialProfileStatus {
  profile: string;
  configured: boolean;
  credentialAvailable: boolean;
  maskedSid?: string;
  backend: CredentialBackend | "unavailable";
  backendAvailable: boolean;
  persistent: boolean;
  storedAt?: string;
  profiles: string[];
  reason?: string;
  remediation?: string;
}

export interface StoredCredentials {
  sid: string;
  password: string;
  profile: string;
  backend: CredentialBackend;
}

interface BackendResolution extends CredentialBackendStatus {
  store?: SecretStore;
}

interface SecretNamespace {
  service: string;
  linuxLabel: string;
}

const CREDENTIAL_SECRET_NAMESPACE: SecretNamespace = {
  service: SUSTECH_CREDENTIAL_SERVICE,
  linuxLabel: "SUSTech CLI CAS",
};

const BLACKBOARD_CALENDAR_LINK_NAMESPACE: SecretNamespace = {
  service: BLACKBOARD_CALENDAR_LINK_SERVICE,
  linuxLabel: "SUSTech CLI Blackboard calendar",
};

export async function loadStoredCredentials(
  requestedProfile?: string,
  options: CredentialStoreOptions = {},
): Promise<StoredCredentials> {
  const config = await readCredentialConfig(options);
  const profile = selectedProfile(requestedProfile, options.env);
  const stored = config.profiles[profile];
  if (!stored) {
    throw new CliError(
      `Credential profile '${profile}' is not configured. Run 'sustech auth login --profile ${profile}'.`,
      "CREDENTIAL_PROFILE_NOT_FOUND",
      2,
      { profile },
    );
  }

  const resolution = await resolveBackendForNamespace(options, CREDENTIAL_SECRET_NAMESPACE);
  const store = requireMatchingStore(resolution, stored.backend);
  let password: string | undefined;
  try {
    password = await store.get(stored.account);
  } catch (error) {
    throw storeAccessError("credentials", "read", store.backend, error);
  }
  if (!password) {
    throw new CliError(
      `Credential profile '${profile}' exists, but its password is missing from the system credential store. Run 'sustech auth login --profile ${profile}' again.`,
      "CREDENTIAL_SECRET_NOT_FOUND",
      2,
      { profile, backend: store.backend },
    );
  }
  return { sid: stored.sid, password, profile, backend: store.backend };
}

export async function saveStoredCredentials(
  input: { profile?: string; sid: string; password: string },
  options: CredentialStoreOptions = {},
): Promise<{ profile: string; maskedSid: string; backend: CredentialBackend; persistent: true }> {
  const profile = validateProfileName(input.profile ?? DEFAULT_CREDENTIAL_PROFILE);
  const sid = validateCredentialSid(input.sid);
  const password = validateCredentialPassword(input.password);

  const config = await readCredentialConfig(options);
  const existing = config.profiles[profile];
  if (existing && existing.sid !== sid) {
    throw new CliError(
      `Profile '${profile}' already belongs to another account. Log it out first or choose a different --profile.`,
      "CREDENTIAL_PROFILE_ACCOUNT_MISMATCH",
      2,
      { profile, maskedSid: maskSid(existing.sid) },
    );
  }

  const resolution = await resolveBackendForNamespace(options, CREDENTIAL_SECRET_NAMESPACE);
  const store = requireAvailableStore(resolution);
  if (existing && existing.backend !== store.backend) {
    throw new CliError(
      `Profile '${profile}' was created with ${existing.backend}, but this system provides ${store.backend}. Log in again with a new profile.`,
      "CREDENTIAL_PROFILE_BACKEND_MISMATCH",
      2,
      { profile, storedBackend: existing.backend, currentBackend: store.backend },
    );
  }

  const account = existing?.account ?? credentialAccount(profile, sid);
  let previousPassword: string | undefined;
  try {
    previousPassword = await store.get(account);
    await store.set(account, password);
  } catch (error) {
    throw storeAccessError("credentials", "write", store.backend, error);
  }

  const next: CredentialConfig = {
    schemaVersion: "1",
    profiles: {
      ...config.profiles,
      [profile]: {
        sid,
        account,
        backend: store.backend,
        storedAt: new Date().toISOString(),
      },
    },
  };
  try {
    await writeCredentialConfig(next, options);
  } catch (error) {
    const restored = await restoreSecret(store, account, previousPassword);
    if (!restored) throw credentialRollbackError("save", store.backend);
    throw error;
  }

  return { profile, maskedSid: maskSid(sid), backend: store.backend, persistent: true };
}

export async function deleteStoredCredentials(
  requestedProfile?: string,
  options: CredentialStoreOptions = {},
): Promise<{ profile: string; removed: boolean; backend: CredentialBackend | "unavailable" }> {
  const config = await readCredentialConfig(options);
  const profile = selectedProfile(requestedProfile, options.env);
  const existing = config.profiles[profile];
  if (!existing) return { profile, removed: false, backend: "unavailable" };

  const resolution = await resolveBackendForNamespace(options, CREDENTIAL_SECRET_NAMESPACE);
  const store = requireMatchingStore(resolution, existing.backend);
  let previousPassword: string | undefined;
  try {
    previousPassword = await store.get(existing.account);
    const deleted = await store.delete(existing.account);
    if (previousPassword !== undefined && !deleted) {
      throw new Error("Credential store did not confirm deletion of an existing secret.");
    }
    if (await store.get(existing.account) !== undefined) {
      throw new Error("Credential deletion could not be verified.");
    }
  } catch (error) {
    throw storeAccessError("credentials", "delete", store.backend, error);
  }

  const profiles = { ...config.profiles };
  delete profiles[profile];
  const next: CredentialConfig = {
    schemaVersion: "1",
    profiles,
  };
  try {
    await writeCredentialConfig(next, options);
  } catch (error) {
    if (previousPassword !== undefined) {
      const restored = await restoreSecret(store, existing.account, previousPassword);
      if (!restored) throw credentialRollbackError("delete", store.backend);
    }
    throw error;
  }
  return { profile, removed: true, backend: store.backend };
}

export async function getCredentialStatus(
  requestedProfile?: string,
  options: CredentialStoreOptions = {},
): Promise<CredentialProfileStatus> {
  const config = await readCredentialConfig(options);
  const profile = selectedProfile(requestedProfile, options.env);
  const stored = config.profiles[profile];
  const profiles = Object.keys(config.profiles).sort();
  const resolution = await resolveBackendForNamespace(options, CREDENTIAL_SECRET_NAMESPACE);
  if (!stored) {
    return {
      profile,
      configured: false,
      credentialAvailable: false,
      backend: resolution.backend,
      backendAvailable: resolution.available,
      persistent: resolution.persistent,
      profiles,
      ...(resolution.reason ? { reason: resolution.reason } : {}),
      ...(resolution.remediation ? { remediation: resolution.remediation } : {}),
    };
  }

  if (!resolution.store || resolution.store.backend !== stored.backend) {
    return {
      profile,
      configured: true,
      credentialAvailable: false,
      maskedSid: maskSid(stored.sid),
      backend: stored.backend,
      backendAvailable: false,
      persistent: true,
      storedAt: stored.storedAt,
      profiles,
      reason: resolution.reason ?? `The current credential backend does not match ${stored.backend}.`,
      ...(resolution.remediation ? { remediation: resolution.remediation } : {}),
    };
  }

  try {
    const password = await resolution.store.get(stored.account);
    return {
      profile,
      configured: true,
      credentialAvailable: Boolean(password),
      maskedSid: maskSid(stored.sid),
      backend: stored.backend,
      backendAvailable: true,
      persistent: true,
      storedAt: stored.storedAt,
      profiles,
      ...(!password ? { reason: "The profile metadata exists, but the secret is missing from the credential store." } : {}),
    };
  } catch (error) {
    return {
      profile,
      configured: true,
      credentialAvailable: false,
      maskedSid: maskSid(stored.sid),
      backend: stored.backend,
      backendAvailable: false,
      persistent: true,
      storedAt: stored.storedAt,
      profiles,
      reason: safeStoreReason(error),
    };
  }
}

export async function getCredentialBackendStatus(
  options: CredentialStoreOptions = {},
): Promise<CredentialBackendStatus> {
  const { store: _store, ...status } = await resolveBackendForNamespace(options, CREDENTIAL_SECRET_NAMESPACE);
  return status;
}

export async function loadStoredBlackboardCalendarLink(
  requestedProfile?: string,
  options: CredentialStoreOptions = {},
): Promise<{ profile: string; url: string; backend: CredentialBackend }> {
  const profile = selectedProfile(requestedProfile, options.env);
  const resolution = await resolveBackendForNamespace(options, BLACKBOARD_CALENDAR_LINK_NAMESPACE);
  const store = requireAvailableStore(resolution);
  let url: string | undefined;
  try {
    url = await store.get(profileSecretAccount(profile));
  } catch (error) {
    throw storeAccessError("Blackboard calendar link", "read", store.backend, error);
  }
  if (!url) {
    throw new CliError(
      `Blackboard calendar link profile '${profile}' is not configured.`,
      "BLACKBOARD_CALENDAR_LINK_NOT_FOUND",
      2,
      { profile },
    );
  }
  return { profile, url, backend: store.backend };
}

export async function saveStoredBlackboardCalendarLink(
  input: { profile?: string; url: string },
  options: CredentialStoreOptions = {},
): Promise<{ profile: string; backend: CredentialBackend; persistent: true }> {
  const profile = validateProfileName(input.profile ?? DEFAULT_CREDENTIAL_PROFILE);
  const url = validateStoredSecret(input.url, "Calendar link", "INVALID_BLACKBOARD_CALENDAR_LINK");
  const resolution = await resolveBackendForNamespace(options, BLACKBOARD_CALENDAR_LINK_NAMESPACE);
  const store = requireAvailableStore(resolution);
  try {
    await store.set(profileSecretAccount(profile), url);
  } catch (error) {
    throw storeAccessError("Blackboard calendar link", "write", store.backend, error);
  }
  return { profile, backend: store.backend, persistent: true };
}

export async function deleteStoredBlackboardCalendarLink(
  requestedProfile?: string,
  options: CredentialStoreOptions = {},
): Promise<{ profile: string; removed: boolean; backend: CredentialBackend | "unavailable" }> {
  const profile = selectedProfile(requestedProfile, options.env);
  const resolution = await resolveBackendForNamespace(options, BLACKBOARD_CALENDAR_LINK_NAMESPACE);
  const store = requireAvailableStore(resolution);
  try {
    const removed = await store.delete(profileSecretAccount(profile));
    if (removed && await store.get(profileSecretAccount(profile)) !== undefined) {
      throw new Error("Secret deletion could not be verified.");
    }
    return { profile, removed, backend: store.backend };
  } catch (error) {
    throw storeAccessError("Blackboard calendar link", "delete", store.backend, error);
  }
}

export function validateProfileName(value: string): string {
  const profile = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(profile)) {
    throw new CliError(
      "Credential profile names must be 1-64 characters using letters, numbers, dot, underscore, or hyphen.",
      "INVALID_CREDENTIAL_PROFILE",
      2,
    );
  }
  return profile;
}

export function maskSid(value: string): string {
  if (value.length <= 4) return "*".repeat(value.length);
  return `${value.slice(0, 2)}${"*".repeat(Math.max(2, value.length - 4))}${value.slice(-2)}`;
}

export function validateCredentialPassword(value: string): string {
  return validateStoredSecret(value, "Password", "INVALID_CREDENTIAL_PASSWORD");
}

export function validateCredentialSid(value: string): string {
  const sid = value.trim();
  if (!sid || sid.length > 128 || /[\u0000-\u001f\u007f]/.test(sid)) {
    throw new CliError("Student ID must be 1-128 printable characters.", "INVALID_CREDENTIAL_SID", 2);
  }
  return sid;
}

function credentialAccount(profile: string, sid: string): string {
  return `${profile}:${sid}`;
}

function selectedProfile(
  requestedProfile: string | undefined,
  customEnv: NodeJS.ProcessEnv | undefined,
): string {
  const env = customEnv ?? process.env;
  const environmentProfile = env.SUSTECH_PROFILE?.trim() || undefined;
  return validateProfileName(requestedProfile ?? environmentProfile ?? DEFAULT_CREDENTIAL_PROFILE);
}

async function resolveBackend(options: CredentialStoreOptions): Promise<BackendResolution> {
  return await resolveBackendForNamespace(options, CREDENTIAL_SECRET_NAMESPACE);
}

async function resolveBackendForNamespace(
  options: CredentialStoreOptions,
  namespace: SecretNamespace,
): Promise<BackendResolution> {
  if (options.store) {
    return {
      backend: options.store.backend,
      available: true,
      persistent: true,
      store: options.store,
    };
  }
  const env = options.env ?? process.env;
  if (env.SUSTECH_DISABLE_SYSTEM_KEYRING?.trim() === "1") {
    return {
      backend: "unavailable",
      available: false,
      persistent: false,
      reason: "System credential storage was disabled by SUSTECH_DISABLE_SYSTEM_KEYRING=1.",
      remediation: "Unset SUSTECH_DISABLE_SYSTEM_KEYRING to re-enable the operating-system credential store.",
    };
  }
  const platform = options.platform ?? process.platform;
  if (platform === "darwin") return await resolveMacosKeychain(options.env, namespace);
  if (platform === "win32") return await resolveWindowsCredentialManager(namespace);
  if (platform === "linux") return await resolveLinuxSecretService(options.env, namespace);
  return {
    backend: "unavailable",
    available: false,
    persistent: false,
    reason: `System credential storage is not supported on ${platform}.`,
    remediation: "Use process-scoped SUSTECH_SID and SUSTECH_PASSWORD from an external secret manager.",
  };
}

async function resolveMacosKeychain(
  customEnv: NodeJS.ProcessEnv | undefined,
  namespace: SecretNamespace,
): Promise<BackendResolution> {
  const backend = "macos-keychain" as const;
  const executable = "/usr/bin/security";
  const env = customEnv ?? process.env;
  try {
    await access(executable, constants.X_OK);
    const { AsyncEntry } = await import("@napi-rs/keyring");
    // Construction initializes the native Security-framework store without reading or writing a credential.
    new AsyncEntry(namespace.service, "availability-probe");
    const store: SecretStore = {
      backend,
      persistent: true,
      async get(account) {
        const password = await new AsyncEntry(namespace.service, account).getPassword() ?? undefined;
        if (password !== undefined) return password;
        if (!await macosCredentialExists(executable, namespace.service, account, env)) return undefined;
        throw new Error("macOS Keychain item exists, but its secret could not be read.");
      },
      async set(account, password) {
        await new AsyncEntry(namespace.service, account).setPassword(password);
      },
      async delete(account) {
        const deleted = await new AsyncEntry(namespace.service, account).deleteCredential();
        if (await macosCredentialExists(executable, namespace.service, account, env)) {
          throw new Error("macOS Keychain delete could not be verified.");
        }
        return deleted;
      },
    };
    return { backend, available: true, persistent: true, store };
  } catch (error) {
    return {
      backend,
      available: false,
      persistent: true,
      reason: safeStoreReason(error),
      remediation: "Reinstall sustech-cli so its native keyring package matches this macOS system and CPU.",
    };
  }
}

async function macosCredentialExists(
  executable: string,
  service: string,
  account: string,
  env: NodeJS.ProcessEnv,
): Promise<boolean> {
  const result = await runCredentialCommand(executable, [
    "find-generic-password", "-s", service, "-a", account,
  ], undefined, env);
  if (macosItemNotFound(result)) return false;
  if (result.code !== 0) throw new Error("macOS Keychain metadata lookup failed.");
  return true;
}

function macosItemNotFound(result: { code: number; stderr: string }): boolean {
  return result.code === 44
    && /(?:specified item could not be found|errSecItemNotFound|-25300)/i.test(result.stderr);
}

async function resolveWindowsCredentialManager(namespace: SecretNamespace): Promise<BackendResolution> {
  const backend = "windows-credential-manager" as const;
  try {
    const { AsyncEntry, findCredentialsAsync } = await import("@napi-rs/keyring");
    new AsyncEntry(namespace.service, "availability-probe");
    const store: SecretStore = {
      backend,
      persistent: true,
      async get(account) {
        const matches = (await findCredentialsAsync(namespace.service))
          .filter((credential) => credential.account === account);
        if (matches.length > 1) throw new Error("Windows Credential Manager returned an ambiguous credential.");
        return matches[0]?.password;
      },
      async set(account, password) {
        await new AsyncEntry(namespace.service, account).setPassword(password);
      },
      async delete(account) {
        return await new AsyncEntry(namespace.service, account).deleteCredential();
      },
    };
    return { backend, available: true, persistent: true, store };
  } catch (error) {
    return {
      backend,
      available: false,
      persistent: true,
      reason: safeStoreReason(error),
      remediation: "Reinstall sustech-cli so its native keyring package matches this Windows system and CPU.",
    };
  }
}

async function resolveLinuxSecretService(
  customEnv: NodeJS.ProcessEnv | undefined,
  namespace: SecretNamespace,
): Promise<BackendResolution> {
  const env = customEnv ?? process.env;
  if (!env.DBUS_SESSION_BUS_ADDRESS) {
    return {
      backend: "linux-secret-service",
      available: false,
      persistent: true,
      reason: "No desktop D-Bus session is available, so Secret Service cannot be used safely.",
      remediation: "Run inside an unlocked desktop session, or inject credentials from an external secret manager.",
    };
  }
  const executable = await findExecutable("secret-tool", env.PATH);
  if (!executable) {
    return {
      backend: "linux-secret-service",
      available: false,
      persistent: true,
      reason: "secret-tool is not installed; the CLI will not fall back to session-only kernel keyrings.",
      remediation: "Install libsecret-tools for your distribution, or inject credentials from an external secret manager.",
    };
  }
  const store: SecretStore = {
    backend: "linux-secret-service",
    persistent: true,
    async get(account) {
      const result = await runCredentialCommand(executable, [
        "lookup", "service", namespace.service, "account", account,
      ], undefined, env);
      if (result.code === 1 && !result.stdout.trim() && !result.stderr.trim()) return undefined;
      if (result.code !== 0) throw new Error("Secret Service lookup failed.");
      return result.stdout.replace(/\r?\n$/, "") || undefined;
    },
    async set(account, password) {
      const result = await runCredentialCommand(executable, [
        "store",
        `--label=${namespace.linuxLabel} (${account.split(":", 1)[0]})`,
        "service", namespace.service,
        "account", account,
      ], `${password}\n`, env);
      if (result.code !== 0) throw new Error("Secret Service write failed.");
    },
    async delete(account) {
      const result = await runCredentialCommand(executable, [
        "clear", "service", namespace.service, "account", account,
      ], undefined, env);
      if (result.code === 1 && !result.stderr.trim()) return false;
      if (result.code !== 0) throw new Error("Secret Service delete failed.");
      return true;
    },
  };
  return {
    backend: "linux-secret-service",
    available: true,
    persistent: true,
    store,
  };
}

async function findExecutable(name: string, pathValue: string | undefined): Promise<string | undefined> {
  for (const directory of (pathValue ?? "").split(delimiter).filter(Boolean)) {
    const candidate = join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue searching PATH.
    }
  }
  return undefined;
}

async function runCredentialCommand(
  executable: string,
  args: string[],
  input: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= 64 * 1024) stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= 64 * 1024) stderr.push(chunk);
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({
      code: code ?? 1,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
    if (input !== undefined) child.stdin.end(input, "utf8");
    else child.stdin.end();
  });
}

function requireAvailableStore(resolution: BackendResolution): SecretStore {
  if (resolution.store) return resolution.store;
  throw new CliError(
    resolution.reason ?? "No secure system credential store is available.",
    "CREDENTIAL_STORE_UNAVAILABLE",
    2,
    {
      backend: resolution.backend,
      persistent: resolution.persistent,
      ...(resolution.remediation ? { remediation: resolution.remediation } : {}),
    },
  );
}

function requireMatchingStore(resolution: BackendResolution, expected: CredentialBackend): SecretStore {
  const store = requireAvailableStore(resolution);
  if (store.backend !== expected) {
    throw new CliError(
      `This profile uses ${expected}, but the current system provides ${store.backend}.`,
      "CREDENTIAL_PROFILE_BACKEND_MISMATCH",
      2,
      { storedBackend: expected, currentBackend: store.backend },
    );
  }
  return store;
}

function storeAccessError(subject: string, operation: string, backend: CredentialBackend, error: unknown): CliError {
  return new CliError(
    `Could not ${operation} ${subject} using ${backend}.`,
    "CREDENTIAL_STORE_ERROR",
    2,
    { backend, operation, reason: safeStoreReason(error) },
  );
}

function validateStoredSecret(value: string, subject: string, code: string): string {
  if (!value || /[\r\n]/.test(value) || Buffer.byteLength(value, "utf8") > 16 * 1024) {
    throw new CliError(
      `${subject} must be one non-empty line no larger than 16 KiB.`,
      code,
      2,
    );
  }
  return value;
}

async function restoreSecret(
  store: SecretStore,
  account: string,
  previousPassword: string | undefined,
): Promise<boolean> {
  try {
    if (previousPassword === undefined) {
      const deleted = await store.delete(account);
      if (!deleted && await store.get(account) !== undefined) return false;
    } else {
      await store.set(account, previousPassword);
    }
    const restored = await store.get(account);
    return previousPassword === undefined ? restored === undefined : restored === previousPassword;
  } catch {
    return false;
  }
}

function credentialRollbackError(operation: "save" | "delete", backend: CredentialBackend): CliError {
  return new CliError(
    `Could not complete credential ${operation}; rollback in ${backend} could not be verified.`,
    "CREDENTIAL_STORE_ROLLBACK_FAILED",
    2,
    {
      backend,
      operation,
      remediation: "Inspect the SUSTech CLI CAS entry in the operating-system credential manager before retrying.",
    },
  );
}

function safeStoreReason(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) return `Credential store error ${String(error.code)}.`;
  return error instanceof Error && /^Secret Service /.test(error.message)
    ? error.message
    : "The operating-system credential store rejected or could not complete the request.";
}

async function readCredentialConfig(options: CredentialStoreOptions): Promise<CredentialConfig> {
  const path = credentialConfigPath(options);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return { schemaVersion: "1", profiles: {} };
    throw new CliError("Could not read credential profile metadata.", "CREDENTIAL_CONFIG_UNREADABLE", 2, { path });
  }
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isCredentialConfig(value)) throw new Error("invalid shape");
    return value;
  } catch {
    throw new CliError(
      "Credential profile metadata is invalid; refusing to overwrite it.",
      "CREDENTIAL_CONFIG_INVALID",
      2,
      { path },
    );
  }
}

async function writeCredentialConfig(config: CredentialConfig, options: CredentialStoreOptions): Promise<void> {
  const directory = credentialConfigDirectory(options);
  const path = join(directory, "credentials.json");
  const temporary = join(directory, `.credentials.${randomUUID()}.tmp`);
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw new CliError(
      "Could not write credential profile metadata; the password was not intentionally left updated.",
      "CREDENTIAL_CONFIG_WRITE_FAILED",
      2,
      { path, reason: isNodeError(error) ? error.code : "unknown" },
    );
  }
}

function credentialConfigPath(options: CredentialStoreOptions): string {
  return join(credentialConfigDirectory(options), "credentials.json");
}

function credentialConfigDirectory(options: CredentialStoreOptions): string {
  if (options.configDir) return options.configDir;
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  return defaultConfigDirectory({ env, platform });
}

function profileSecretAccount(profile: string): string {
  return profile;
}

function isCredentialConfig(value: unknown): value is CredentialConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== "1" || !record.profiles || typeof record.profiles !== "object" || Array.isArray(record.profiles)) {
    return false;
  }
  for (const [profile, entry] of Object.entries(record.profiles as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(profile) || !entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const stored = entry as Record<string, unknown>;
    if (
      typeof stored.sid !== "string"
      || typeof stored.account !== "string"
      || !isCredentialBackend(stored.backend)
      || typeof stored.storedAt !== "string"
    ) return false;
  }
  return true;
}

function isCredentialBackend(value: unknown): value is CredentialBackend {
  return value === "macos-keychain" || value === "windows-credential-manager" || value === "linux-secret-service";
}

function isNodeError(error: unknown, code?: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && (code === undefined || (error as NodeJS.ErrnoException).code === code);
}
