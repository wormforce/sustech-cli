import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CliError } from "./errors.js";

interface PathOperations {
  dirname(path: string): string;
  resolve(path: string): string;
}

export interface ConfigDirectoryOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDirectory?: string;
}

export function defaultConfigDirectory(options: ConfigDirectoryOptions = {}): string {
  const env = options.env ?? process.env;
  const xdgConfigHome = env.XDG_CONFIG_HOME?.trim();
  if (xdgConfigHome) return join(xdgConfigHome, "sustech-cli");
  const platform = options.platform ?? process.platform;
  const appData = env.APPDATA?.trim();
  if (platform === "win32" && appData) return join(appData, "sustech-cli");
  const userHome = options.homeDirectory ?? homedir();
  if (platform === "darwin") return join(userHome, "Library", "Application Support", "sustech-cli");
  return join(userHome, ".config", "sustech-cli");
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
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let wroteTemporary = false;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", 0o600);
    wroteTemporary = true;
    await handle.writeFile(JSON.stringify(value, null, 2), "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    if (wroteTemporary) await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function assertPathAndParentsAreNotSymlinks(path: string): Promise<void> {
  const resolved = resolve(path);
  for (const current of pathChainForSymlinkGuard(path)) {
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        if (process.platform === "darwin" && MACOS_SYSTEM_PATH_ALIASES.has(current)) continue;
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

export function pathChainForSymlinkGuard(path: string, pathOps: PathOperations = { dirname, resolve }): string[] {
  const resolved = pathOps.resolve(path);
  const chain: string[] = [];
  let current = resolved;
  for (;;) {
    chain.push(current);
    const parent = pathOps.dirname(current);
    if (parent === current) return chain.reverse();
    current = parent;
  }
}

// macOS ships these root-owned aliases into /private. They are not
// user-controlled path components and rejecting them makes normal /tmp and
// os.tmpdir() destinations unusable. All later path components remain guarded.
const MACOS_SYSTEM_PATH_ALIASES = new Set(["/etc", "/tmp", "/var"]);
