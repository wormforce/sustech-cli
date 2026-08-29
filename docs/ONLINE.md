# SUSTech Online public layer

The `online` commands read a deliberately small subset of the public,
community-maintained [SUSTech Online](https://sustech.online) manual. They do
not require a campus account:

```bash
sustech online talks list --since 2026-09-01 --limit 20
sustech online talks search "artificial intelligence" --limit 10
sustech online talks get 2026-07-30T10-00-00_François_Forget
sustech online contact search "教学" --limit 10
sustech online contact get teaching:教学工作部
sustech online search "library" --section contact
```

## Authority and freshness

SUSTech Online is a community source, not an official university system. Every
record retains:

- `authority: "community"`;
- the public page URL and repository path;
- page update time when the rendered site exposes it;
- the fetch time;
- the upstream `CC-BY-SA-4.0` license and link;
- explicit `COMMUNITY_MAINTAINED`, `AI_PROCESSED_SOURCE`,
  `SOURCE_UPDATE_UNKNOWN`, and `STALE_SOURCE` advisories when applicable.

The talks source itself says its entries are compiled from public information
and processed by a model, so talk results always retain
`AI_PROCESSED_SOURCE`. Contact results do not receive that label unless the
source changes to say so. A missing rendered-page timestamp does not block a
raw public read, but it is reported as `SOURCE_UPDATE_UNKNOWN`.

Use these records for discovery and convenience. Recheck time-sensitive talk
details and important institutional contacts against the linked official page
before acting.

## Selected contact scope

The contact parser is an allowlist, not a full mirror of the source page. It
keeps selected institutional teaching, administration, general service, and
non-dining logistics records. It intentionally excludes:

- professor email lists;
- medical, safety, emergency, and psychological-crisis sections;
- dining/community-chat and QQ-group lists;
- reimbursement, bank-account, tax, and invoice information;
- postal examples, informal personal notes, and lost-and-found guidance.

This prevents a general campus search command from becoming an emergency or
financial authority. The CLI does not provide a dedicated emergency command.

## Network boundary

The client fetches only the exact allowlisted Markdown files from the public
`SUSTech-CRA/sustech-online-ng` repository and the matching rendered
`sustech.online` page used for update metadata. Redirects are rejected, final
origins and exact paths are checked, document size and timeout are bounded, and
talk identifiers can resolve to only one file in the talks directory.

Returned institutional links are limited to `sustech.edu.cn` subdomains and
the community site. Poster links are limited to those hosts plus the exact
image-mirror host currently used by the upstream talks archive; unrelated,
social, document-sharing, and deceptive lookalike domains are omitted.

Rendered-page metadata is optional; raw Markdown is required. Tests use frozen
synthetic fixtures and do not copy the upstream contact or talks content into
the package.
