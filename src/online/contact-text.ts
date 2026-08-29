import { formatOnlineAdvisories } from "./shared.js";
import { contactSearchSnippet } from "./contact.js";
import type { OnlineContactRecord } from "./types.js";

export function formatOnlineContacts(records: readonly OnlineContactRecord[], title = "SUSTech Online contacts"): string {
  if (records.length === 0) return `${title}\n\nNo public institutional contacts matched.`;
  const blocks = records.map((record, index) => [
    `${index + 1}. ${record.name}`,
    `   Id: ${record.id}`,
    `   Category: ${record.category}`,
    record.address ? `   Address: ${record.address}` : "",
    record.phones.length > 0 ? `   Phones: ${record.phones.join(", ")}` : "",
    record.emails.length > 0 ? `   Emails: ${record.emails.join(", ")}` : "",
    record.hours && record.hours.length > 0 ? `   Hours: ${record.hours.join("; ")}` : "",
    record.websiteUrl ? `   Website: ${record.websiteUrl}` : "",
    record.notes.length > 0 ? `   Notes: ${record.notes.join(" | ")}` : "",
    `   Source: ${record.provenance.sourceRepoPath}${record.provenance.sourceUpdatedAt ? ` · updated ${record.provenance.sourceUpdatedAt}` : ""} · ${record.provenance.license}`,
    `   Advisories: ${formatOnlineAdvisories(record.provenance.advisories)}`,
  ].filter(Boolean).join("\n"));
  return `${title}\n\n${blocks.join("\n\n")}\n\n${records.length} contact(s).`;
}

export function formatOnlineContact(record: OnlineContactRecord): string {
  return formatOnlineContacts([record], `SUSTech Online contact · ${record.name}`);
}

export function formatOnlineContactSearch(records: readonly OnlineContactRecord[], query: string): string {
  if (records.length === 0) return `SUSTech Online contact search · ${query}\n\nNo public institutional contacts matched.`;
  const blocks = records.map((record, index) => [
    `${index + 1}. ${record.name} [${record.id}]`,
    `   ${contactSearchSnippet(record)}`,
  ].join("\n"));
  return `SUSTech Online contact search · ${query}\n\n${blocks.join("\n\n")}\n\n${records.length} match(es).`;
}
