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
  "--status",
  "--period-start",
  "--period-end",
  "--week-one-monday",
  "--teaching-start",
  "--calendar-name",
  "--where",
  "--pick",
  "--bid-limit",
  "--cultivation",
  "--year",
  "--calendar-level",
  "--date",
  "--level",
  "--department",
  "--minutes",
  "--category",
  "--page",
  "--page-size",
  "--sort",
  "--min-year",
  "--parent-id",
  "--content-id",
  "--column-id",
  "--file",
  "--comment",
  "--expected-sha256",
  "--destination",
  "--program-code",
  "--program-token",
  "--start",
  "--end",
  "--begin",
  "--kind-id",
  "--lab-id",
  "--class-kind",
  "--need-status",
  "--server-group",
  "--type",
  "--color",
  "--paper",
  "--duplex",
  "--copies",
  "--page-from",
  "--page-to",
  "--service",
  "--profile",
  "--sid",
  "--path",
  "--requirements",
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
  if (group === "version" || group === "capabilities" || group === "context" || group === "consequences") return group;
  if (!command) return group;
  if (
    (group === "tis" && ["courses", "enroll", "classroom", "selection", "bid", "plan", "degree"].includes(command))
    || (group === "academic" && command === "snapshot")
    || (group === "bb" && command === "submit")
    || (group === "pms" && (command === "upload" || command === "delete"))
  ) {
    return positionals.slice(0, 3).join(" ");
  }
  return positionals.slice(0, 2).join(" ");
}
