import { CliError } from "./errors.js";

export function normaliseHttpsBase(value: string | undefined): string | undefined {
  const candidate = value?.trim().replace(/\/+$/, "");
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return undefined;
  } catch {
    return undefined;
  }
  return candidate;
}

export function resolveHttpsBase(
  variable: string,
  defaultValue: string,
  invalidCode: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env[variable]?.trim();
  if (!configured) return defaultValue;
  const normalised = normaliseHttpsBase(configured);
  if (!normalised) {
    throw new CliError(
      `${variable} must be a plain HTTPS URL without credentials, a query string, or a fragment.`,
      invalidCode,
      2,
      { variable },
    );
  }
  return normalised;
}
