import { randomBytes, pbkdf2, createCipheriv, createDecipheriv } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { CliError } from "./errors.js";

const pbkdf2Async = promisify(pbkdf2);

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 600_000;

export interface EncryptedStoreOptions {
  storePath: string;
  getMasterPassword: () => Promise<string>;
}

interface EncryptedEntry {
  salt: string;
  iv: string;
  authTag: string;
  encrypted: string;
}

interface StoreFile {
  version: "1";
  entries: Record<string, EncryptedEntry>;
}

export class EncryptedStore {
  private readonly storePath: string;
  private readonly getMasterPassword: () => Promise<string>;
  private cachedMasterPassword?: string;

  public constructor(options: EncryptedStoreOptions) {
    this.storePath = options.storePath;
    this.getMasterPassword = options.getMasterPassword;
  }

  public async has(account: string): Promise<boolean> {
    try {
      const store = await this.readStore();
      return account in store.entries;
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return false;
      throw error;
    }
  }

  public async get(account: string): Promise<string | undefined> {
    try {
      const store = await this.readStore();
      const entry = store.entries[account];
      if (!entry) return undefined;

      const masterPassword = await this.getMasterPasswordCached();
      const salt = Buffer.from(entry.salt, "base64");
      const key = await pbkdf2Async(masterPassword, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha256");
      const iv = Buffer.from(entry.iv, "base64");
      const authTag = Buffer.from(entry.authTag, "base64");
      const encrypted = Buffer.from(entry.encrypted, "base64");

      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);

      return decrypted.toString("utf8");
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return undefined;
      if (error && typeof error === "object" && "message" in error) {
        const message = String(error.message);
        if (/Unsupported state|bad decrypt/i.test(message)) {
          throw new CliError(
            "Encrypted store decryption failed; the master password may be incorrect.",
            "MASTER_PASSWORD_INVALID",
            2,
            { backend: "linux-encrypted-file" },
          );
        }
      }
      throw error;
    }
  }

  public async set(account: string, password: string): Promise<void> {
    const store = await this.readStoreOrEmpty();
    const masterPassword = await this.getMasterPasswordCached();

    const salt = randomBytes(SALT_LENGTH);
    const key = await pbkdf2Async(masterPassword, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha256");
    const iv = randomBytes(IV_LENGTH);

    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(password, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    store.entries[account] = {
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      encrypted: encrypted.toString("base64"),
    };

    await this.writeStore(store);
  }

  public async delete(account: string): Promise<boolean> {
    try {
      const store = await this.readStore();
      if (!(account in store.entries)) return false;

      delete store.entries[account];
      await this.writeStore(store);
      return true;
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return false;
      throw error;
    }
  }

  public async initialize(masterPassword: string): Promise<void> {
    this.cachedMasterPassword = masterPassword;
    const storeDir = join(this.storePath, "..");
    await mkdir(storeDir, { recursive: true, mode: 0o700 });
    await this.writeStore({ version: "1", entries: {} });
  }

  public async exists(): Promise<boolean> {
    try {
      await access(this.storePath, constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  public async verify(masterPassword: string): Promise<boolean> {
    try {
      const store = await this.readStore();
      if (Object.keys(store.entries).length === 0) {
        return true;
      }

      const firstAccount = Object.keys(store.entries)[0];
      const entry = store.entries[firstAccount];

      const salt = Buffer.from(entry.salt, "base64");
      const key = await pbkdf2Async(masterPassword, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha256");
      const iv = Buffer.from(entry.iv, "base64");
      const authTag = Buffer.from(entry.authTag, "base64");
      const encrypted = Buffer.from(entry.encrypted, "base64");

      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);
      decipher.update(encrypted);
      decipher.final();

      return true;
    } catch {
      return false;
    }
  }

  private async getMasterPasswordCached(): Promise<string> {
    if (this.cachedMasterPassword) return this.cachedMasterPassword;
    this.cachedMasterPassword = await this.getMasterPassword();
    return this.cachedMasterPassword;
  }

  private async readStore(): Promise<StoreFile> {
    const raw = await readFile(this.storePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isStoreFile(parsed)) {
      throw new Error("Encrypted store file is corrupted or has an invalid format.");
    }
    return parsed;
  }

  private async readStoreOrEmpty(): Promise<StoreFile> {
    try {
      return await this.readStore();
    } catch (error) {
      if (isNodeError(error, "ENOENT")) {
        return { version: "1", entries: {} };
      }
      throw error;
    }
  }

  private async writeStore(store: StoreFile): Promise<void> {
    const storeDir = join(this.storePath, "..");
    await mkdir(storeDir, { recursive: true, mode: 0o700 });

    const content = JSON.stringify(store, null, 2) + "\n";
    await writeFile(this.storePath, content, { encoding: "utf8", mode: 0o600 });
  }
}

function isStoreFile(value: unknown): value is StoreFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.version !== "1") return false;
  if (!record.entries || typeof record.entries !== "object" || Array.isArray(record.entries)) return false;

  for (const entry of Object.values(record.entries as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const e = entry as Record<string, unknown>;
    if (
      typeof e.salt !== "string"
      || typeof e.iv !== "string"
      || typeof e.authTag !== "string"
      || typeof e.encrypted !== "string"
    ) return false;
  }
  return true;
}

function isNodeError(error: unknown, code?: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && (code === undefined || (error as NodeJS.ErrnoException).code === code);
}
