import { readFile } from "node:fs/promises";
import { CliError } from "./errors.js";

export interface Credentials {
  sid: string;
  password: string;
  source: "environment" | "file";
}

export async function resolveCredentials(credentialsFile?: string): Promise<Credentials> {
  if (credentialsFile) return readCredentialsFile(credentialsFile);

  const sid = process.env.SUSTECH_SID?.trim();
  const password = process.env.SUSTECH_PASSWORD;
  if (sid && password) return { sid, password, source: "environment" };

  const file = process.env.SUSTECH_CREDENTIALS_FILE;
  if (file) {
    return readCredentialsFile(file);
  }

  throw new CliError(
    "Credentials are required. Set SUSTECH_SID and SUSTECH_PASSWORD, or pass --credentials-file.",
    "CREDENTIALS_REQUIRED",
    2,
  );
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
