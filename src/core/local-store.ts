import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { CliError } from "./errors.js";

export function defaultConfigDirectory(): string {
  const base = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), "Library", "Application Support");
  return join(base, "sustech-cli");
}

export function resolveLocalDataPath(path: string | undefined, defaultFileName: string): string {
  const trimmed = path?.trim();
  return trimmed ? resolve(trimmed) : join(defaultConfigDirectory(), defaultFileName);
}

export async function readJsonFile(path: string, notFoundCode: string, invalidCode = notFoundCode): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new CliError(`Local file not found: ${path}`, notFoundCode, 2, { path });
    }
    if (error instanceof SyntaxError) {
      throw new CliError(`Local file is not valid JSON: ${path}`, invalidCode, 2, { path });
    }
    throw error;
  }
}

export async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  await assertPathAndParentsAreNotSymlinks(path);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
  await rename(temporary, path);
}

async function assertPathAndParentsAreNotSymlinks(path: string): Promise<void> {
  const resolved = resolve(path);
  const root = parse(resolved).root;
  const segments = resolved.slice(root.length).split("/").filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = current === root ? join(root, segment) : join(current, segment);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        throw new CliError(
          `Refusing to write through a symbolic link: ${current}`,
          "UNSAFE_LOCAL_PATH",
          2,
          { path: resolved, symlink: current },
        );
      }
    } catch (error) {
      if (error instanceof CliError) throw error;
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
  }
}
