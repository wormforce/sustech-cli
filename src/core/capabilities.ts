export type CapabilityKind = "local" | "read" | "plan" | "mutation";

export interface Capability {
  command: string;
  summary: string;
  kind: CapabilityKind;
  network: boolean;
  authentication: "none" | "sustech-cas" | "tis" | "bb" | "library" | "booking" | "ws" | "pms" | "nces" | "browser";
  confirmation: "none" | "required";
  status: "stable" | "preview";
}

export const CAPABILITIES: readonly Capability[] = [
  capability("version", "Show CLI and runtime versions.", "local"),
  capability("capabilities", "List the machine-discoverable command surface.", "local"),
  capability("consequences", "List structured risks and verification rules for real-state mutations.", "local"),
  capability("calendar terms", "Read semester boundaries from the public academic-calendar dataset.", "read"),
  capability("calendar day", "Resolve a date into teaching week, holiday, makeup, and exam flags.", "read"),
  capability("faculty departments", "List the known public faculty departments.", "read", { network: false }),
  capability("faculty list", "List public faculty profiles in one department.", "read", { status: "preview" }),
  capability("faculty get", "Read one public faculty profile.", "read", { status: "preview" }),
  capability("faculty search", "Search public faculty profile fields.", "read", { status: "preview" }),
  capability("faculty render", "Render a public faculty profile as Agent-readable Markdown.", "read", { status: "preview" }),
  capability("context", "Compose a truthful current-date snapshot with per-source availability.", "read", { status: "preview" }),
  capability("resources list", "List the built-in campus resource registry.", "read", { network: false }),
  capability("resources search", "Search the built-in campus resource registry.", "read", { network: false }),
  capability("wifi status", "Read the current macOS Wi-Fi association.", "read", { network: false }),
  capability("wifi events", "Read recent macOS SUSTC Wi-Fi events.", "read", { network: false }),
  capability("services status", "Report implemented, adapter-required, and unavailable service layers.", "local"),
  capability("papers search", "Search public CrossRef metadata with optional Unpaywall resolution.", "read"),
  capability("nces browse", "Browse public NCES community course evaluations.", "read", { status: "preview" }),
  capability("nces search", "Search public NCES courses and review samples.", "read", { status: "preview" }),
  capability("nces course", "Read one public NCES course and its reviews.", "read", { status: "preview" }),
  capability("bb user", "Read the authenticated Blackboard user profile.", "read", { authentication: "bb", status: "preview" }),
  capability("bb courses", "List the authenticated user's Blackboard courses.", "read", { authentication: "bb", status: "preview" }),
  capability("bb content", "List Blackboard content items for one course or folder.", "read", { authentication: "bb", status: "preview" }),
  capability("bb assignments", "List Blackboard gradebook assignment columns.", "read", { authentication: "bb", status: "preview" }),
  capability("ws programs", "List or search authenticated SUSTech Global programs.", "read", { authentication: "ws", status: "preview" }),
  capability("ws detail", "Read one authenticated SUSTech Global program detail.", "read", { authentication: "ws", status: "preview" }),
  capability("library search-url", "Build a browser handoff URL for Primo without fabricating catalog results.", "plan", { network: false, status: "preview" }),
  capability("auth check", "Verify SUSTech credentials against the selected TIS, Blackboard, or WS CAS target.", "read", { authentication: "sustech-cas", status: "preview" }),
  capability("tis courses search", "Search the campus-wide course catalog.", "read", { authentication: "tis", status: "preview" }),
  capability("tis courses available", "Search courses available to the authenticated student.", "read", { authentication: "tis", status: "preview" }),
  capability("tis enrolled", "Read the normalized enrolled-course schedule.", "read", { authentication: "tis", status: "preview" }),
  capability("tis schedule", "Read a week or full semester personal schedule.", "read", { authentication: "tis", status: "preview" }),
  capability("tis grades", "Read normalized grades and calculate GPA.", "read", { authentication: "tis", status: "preview" }),
  capability("tis exams", "Read the current published exam schedule.", "read", { authentication: "tis", status: "preview" }),
  capability("tis classroom rooms", "Build a classroom directory from the campus course catalog.", "read", { authentication: "tis", status: "preview" }),
  capability("tis classroom occupancy", "Query catalogued classroom occupancy for an exact period.", "read", { authentication: "tis", status: "preview" }),
  capability("tis classroom free", "Find classrooms without a catalogued class in an exact period.", "read", { authentication: "tis", status: "preview" }),
  capability("tis evals", "Read teaching-evaluation task status without submitting answers.", "read", { authentication: "tis", status: "preview" }),
  capability("tis ical", "Export the enrolled schedule as an iCalendar stream.", "read", { authentication: "tis", status: "preview" }),
  capability("tis timetable", "Solve non-conflicting section combinations locally after catalog fetch.", "plan", { authentication: "tis", status: "preview" }),
  capability("tis enroll preview", "Build an exact enrollment action without network or mutation.", "plan", { network: false, status: "preview" }),
  capability("tis selection preview", "Build typed enroll, drop, cart, or bid payloads without sending them.", "plan", { network: false, status: "preview" }),
  capability("tis bid plan", "Validate a multi-course bid budget and build local write previews.", "plan", { network: false, status: "preview" }),
  capability("tis enroll apply", "Submit an enrollment action to TIS.", "mutation", { authentication: "tis", confirmation: "required", status: "preview" }),
  capability("transit facilities", "List public campus buildings and gates.", "read"),
  capability("transit find", "Search public campus facilities and bus stops.", "read"),
  capability("transit lines", "List public bus routes for workdays or holidays.", "read"),
  capability("transit schedule", "Read departures for a public bus route.", "read"),
  capability("transit stops", "List public stops for a live bus route.", "read"),
  capability("transit live", "Read public live bus positions.", "read"),
] as const;

function capability(
  command: string,
  summary: string,
  kind: CapabilityKind,
  overrides: Partial<Omit<Capability, "command" | "summary" | "kind">> = {},
): Capability {
  return {
    command,
    summary,
    kind,
    network: kind === "read" || kind === "mutation" || kind === "plan",
    authentication: "none",
    confirmation: "none",
    status: "stable",
    ...overrides,
  };
}

export function formatCapabilities(capabilities: readonly Capability[]): string {
  const groups = new Map<CapabilityKind, Capability[]>();
  for (const entry of capabilities) groups.set(entry.kind, [...(groups.get(entry.kind) ?? []), entry]);
  const sections = (["local", "read", "plan", "mutation"] as const)
    .filter((kind) => groups.has(kind))
    .map((kind) => [
      kind.toUpperCase(),
      ...(groups.get(kind) ?? []).map((entry) => {
        const flags = [
          entry.authentication !== "none" ? `auth:${entry.authentication}` : "",
          entry.confirmation === "required" ? "confirmation:required" : "",
          entry.network ? "network" : "local",
          entry.status === "preview" ? "preview" : "",
        ].filter(Boolean).join(", ");
        return `  ${entry.command}\n    ${entry.summary} [${flags}]`;
      }),
    ].join("\n"));
  return `Capabilities · schema version 1\n\n${sections.join("\n\n")}`;
}
