import { readFile } from "node:fs/promises";
import { CliError } from "./errors.js";
import {
  loadStoredCredentials,
  type CredentialStoreOptions,
} from "./keyring.js";

export type CredentialSource = "environment" | "file" | "system-keyring" | "interactive";

export interface Credentials {
  sid: string;
  password: string;
  source: CredentialSource;
  profile?: string;
  backend?: string;
}

export interface ResolveCredentialsOptions {
  credentialsFile?: string;
  profile?: string;
  env?: NodeJS.ProcessEnv;
  store?: CredentialStoreOptions;
}

export async function resolveCredentials(
  input: string | ResolveCredentialsOptions = {},
): Promise<Credentials> {
  const options = typeof input === "string" ? { credentialsFile: input } : input;
  if (options.credentialsFile) return readCredentialsFile(options.credentialsFile);

  const env = options.env ?? process.env;
  const sid = env.SUSTECH_SID?.trim();
  const password = env.SUSTECH_PASSWORD;
  if (sid && password) return { sid, password, source: "environment" };

  const file = env.SUSTECH_CREDENTIALS_FILE;
  if (file) {
    return readCredentialsFile(file);
  }

  try {
    const stored = await loadStoredCredentials(options.profile, {
      ...options.store,
      env: options.store?.env ?? env,
    });
    return {
      sid: stored.sid,
      password: stored.password,
      source: "system-keyring",
      profile: stored.profile,
      backend: stored.backend,
    };
  } catch (error) {
    if (error instanceof CliError && error.code === "CREDENTIAL_PROFILE_NOT_FOUND") {
      throw new CliError(
        "Credentials are required. Run 'sustech auth login', inject SUSTECH_SID and SUSTECH_PASSWORD, or pass --credentials-file.",
        "CREDENTIALS_REQUIRED",
        2,
        { profile: options.profile ?? (env.SUSTECH_PROFILE?.trim() || "default") },
      );
    }
    throw error;
  }
}

async function readCredentialsFile(file: string): Promise<Credentials> {
  let raw: string;
  try {
    raw = (await readFile(file, "utf8")).trim();
  } catch (error) {
    throw new CliError(
      "Could not read the credentials file.",
      "CREDENTIALS_FILE_UNREADABLE",
      2,
      { path: file, cause: error instanceof Error ? error.message : String(error) },
    );
  }
  const delimiter = raw.indexOf(":");
  if (!raw.includes("\n") && !raw.includes("\r") && delimiter > 0 && raw.slice(delimiter + 1)) {
    return {
      sid: raw.slice(0, delimiter).trim(),
      password: raw.slice(delimiter + 1),
      source: "file",
    };
  }
  throw new CliError(
    "Credentials file must contain exactly one sid:password line.",
    "INVALID_CREDENTIALS_FILE",
    2,
    { path: file },
  );
}
