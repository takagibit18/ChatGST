# Knowledge audit

The user supplied 47 nationwide Markdown files in an external read-only directory. On 2026-07-23 all 47 were decoded with strict UTF-8, checked for replacement characters and checked for at least one source URL. No malformed UTF-8, replacement character or URL-less file was found.

The product scope is Beijing and Hebei, so two relevant originals were copied byte-for-byte into `knowledge/raw/`. Their SHA-256 hashes are recorded by `pnpm knowledge:inspect`; the source files are never rewritten.

Findings:

- The Beijing file contains the full trial implementation rules, headings, numbered articles, application channels, review/payment rules and official source URL. Its official publication date is 2025-09-24 and implementation date is 2025-09-26.
- The Hebei file is an official explanation and links to the complete rules, but its harvested frontmatter timestamp (`2025-06-19`) conflicts with the official page publication date (`2026-01-12`). Metadata corrects this without touching the source.
- Neither selected raw item alone is enough for all demo questions. Immutable curated snapshots add the national amount/application FAQ, Hebei complete rules, Beijing's 2026 initial-application deadline update, and the official maternity-allowance distinction.
- Headings, articles, paragraphs, lists and tables are preserved. The semantic chunker never mutates source Markdown.

