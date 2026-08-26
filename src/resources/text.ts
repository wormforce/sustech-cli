import type { CampusResource } from "./catalog.js";

export function formatResources(resources: readonly CampusResource[], title = "Campus resources"): string {
  if (resources.length === 0) return `${title}\nNo matching resources.`;
  return [
    `${title} · ${resources.length}`,
    ...resources.map((entry) => `${entry.id.padEnd(14)} ${entry.name}\n${" ".repeat(15)}${entry.url}\n${" ".repeat(15)}${entry.summary}`),
  ].join("\n");
}
