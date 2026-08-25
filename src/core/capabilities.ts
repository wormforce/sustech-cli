export type CapabilityKind = "local" | "read" | "plan" | "mutation";

export interface Capability {
  command: string;
  summary: string;
  kind: CapabilityKind;
  network: boolean;
  authentication: "none" | "tis";
  confirmation: "none" | "required";
  status: "stable" | "preview";
}

export const CAPABILITIES: readonly Capability[] = [
  capability("version", "Show CLI and runtime versions.", "local"),
  capability("capabilities", "List the machine-discoverable command surface.", "local"),
  capability("auth check", "Verify SUSTech credentials against TIS CAS.", "read", { authentication: "tis", status: "preview" }),
  capability("tis courses search", "Search the campus-wide course catalog.", "read", { authentication: "tis", status: "preview" }),
  capability("tis courses available", "Search courses available to the authenticated student.", "read", { authentication: "tis", status: "preview" }),
  capability("tis enrolled", "Read the normalized enrolled-course schedule.", "read", { authentication: "tis", status: "preview" }),
  capability("tis schedule", "Read a week or full semester personal schedule.", "read", { authentication: "tis", status: "preview" }),
  capability("tis grades", "Read normalized grades and calculate GPA.", "read", { authentication: "tis", status: "preview" }),
  capability("tis exams", "Read the current published exam schedule.", "read", { authentication: "tis", status: "preview" }),
  capability("tis timetable", "Solve non-conflicting section combinations locally after catalog fetch.", "plan", { authentication: "tis", status: "preview" }),
  capability("tis enroll preview", "Build an exact enrollment action without network or mutation.", "plan", { network: false, status: "preview" }),
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
