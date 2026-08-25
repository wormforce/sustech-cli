const VALUE_OPTIONS = new Set([
  "--semester",
  "--limit",
  "--round",
  "--credentials-file",
  "--course-id",
  "--rwh",
  "--bid",
  "--output",
  "--week",
  "--max",
  "--block",
  "--day",
  "--direction",
  "--route-index",
]);

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
  if (group === "version" || group === "capabilities") return group;
  if (!command) return group;
  if (group === "tis" && (command === "courses" || command === "enroll")) {
    return positionals.slice(0, 3).join(" ");
  }
  return positionals.slice(0, 2).join(" ");
}
