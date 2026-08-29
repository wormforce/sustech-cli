import { CliError } from "../core/errors.js";
import { searchOnlineContacts, contactSearchSnippet } from "./contact.js";
import { formatOnlineAdvisories, scoreSearchMatch } from "./shared.js";
import { searchOnlineTalks, talkSearchSnippet } from "./talks.js";
import type { OnlineFetchOptions } from "./shared.js";
import type { OnlineSearchHit } from "./types.js";

export interface OnlineSearchOptions extends OnlineFetchOptions {
  limit?: number;
  section?: "talks" | "contact";
  since?: string;
  until?: string;
}

export async function searchOnline(query: string, options: OnlineSearchOptions = {}): Promise<OnlineSearchHit[]> {
  const withoutLimit = { ...options, limit: undefined };
  const [talks, contacts] = await Promise.all([
    options.section === "contact" ? Promise.resolve([]) : searchOnlineTalks(query, withoutLimit),
    options.section === "talks" ? Promise.resolve([]) : searchOnlineContacts(query, withoutLimit),
  ]);
  const hits = [
    ...talks.map((talk) => ({
      kind: "talk" as const,
      id: talk.id,
      title: talk.title,
      subtitle: [talk.date, talk.timeText, talk.speakerLine].filter(Boolean).join(" · "),
      snippet: talkSearchSnippet(talk),
      url: talk.detailUrl,
      provenance: talk.provenance,
    })),
    ...contacts.map((contact) => ({
      kind: "contact" as const,
      id: contact.id,
      title: contact.name,
      subtitle: contact.category,
      snippet: contactSearchSnippet(contact),
      url: contact.websiteUrl,
      provenance: contact.provenance,
    })),
  ];
  const ranked = hits
    .map((hit) => ({
      hit,
      score: scoreSearchMatch(query, [
        { value: hit.title, weight: 10 },
        { value: hit.subtitle, weight: 7 },
        { value: hit.snippet, weight: 3 },
      ]),
    }))
    .sort((left, right) => right.score - left.score || left.hit.title.localeCompare(right.hit.title, "zh-Hans-CN"))
    .map((entry) => entry.hit);
  if (options.limit === undefined) return ranked;
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 200) {
    throw new CliError("Online search limits must be integers from 1 to 200.", "USAGE", 2);
  }
  return ranked.slice(0, options.limit);
}

export function formatOnlineSearchHits(hits: readonly OnlineSearchHit[], query: string): string {
  if (hits.length === 0) return `SUSTech Online search · ${query}\n\nNo public community-maintained records matched.`;
  const blocks = hits.map((hit, index) => [
    `${index + 1}. [${hit.kind}] ${hit.title}`,
    hit.subtitle ? `   ${hit.subtitle}` : "",
    `   ${hit.snippet}`,
    `   Source: ${hit.provenance.sourceRepoPath} · ${hit.provenance.license}`,
    `   Advisories: ${formatOnlineAdvisories(hit.provenance.advisories)}`,
  ].filter(Boolean).join("\n"));
  return `SUSTech Online search · ${query}\n\n${blocks.join("\n\n")}\n\n${hits.length} hit(s).`;
}
