import { CLI_PARSE_OPTIONS } from "./command-metadata.js";

const VALUE_OPTIONS = new Set(
  Object.entries(CLI_PARSE_OPTIONS)
    .filter(([, definition]) => definition.type === "string")
    .map(([name]) => `--${name}`),
);

export function inferCommandName(argv: string[]): string {
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument.startsWith("--") && argument.includes("=")) continue;
    if (argument.startsWith("-")) {
      if (VALUE_OPTIONS.has(argument)) index += 1;
      continue;
    }
    positionals.push(argument);
  }

  const [group, command] = positionals;
  if (!group) return "unknown";
  if (group === "version" || group === "capabilities" || group === "context" || group === "consequences" || group === "describe") return group;
  if (!command) return group;
  if (
    (group === "tis" && ["courses", "enroll", "classroom", "selection", "bid", "plan", "degree"].includes(command))
    || (group === "academic" && command === "snapshot")
    || (group === "bb" && ["submit", "calendar-link"].includes(command))
    || (group === "pms" && (command === "upload" || command === "delete"))
    || (group === "booking" && ["create", "cancel"].includes(command))
    || (group === "lib-booking" && ["create", "cancel"].includes(command))
  ) {
    return positionals.slice(0, 3).join(" ");
  }
  return positionals.slice(0, 2).join(" ");
}
