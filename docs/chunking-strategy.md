# Policy chunking strategy

The supplied Beijing Markdown is not conventional heading-only Markdown: the policy title is bold, chapters and articles are plain lines, paragraphs follow articles, and application procedures contain Chinese numbered lists. The Hebei explanation mixes prose, links and list-like sections. Curated official snapshots use Markdown headings. A fixed line-count chunker would split legal units and lose parent context.

`SemanticPolicyChunker` therefore:

1. recognizes Markdown headings, bold standalone titles, Chinese chapter labels and article labels;
2. starts a semantic unit at each chapter/article while retaining the chapter in `section_path`;
3. keeps paragraphs, Chinese numbered items, ordinary lists and Markdown tables with their current legal unit;
4. only splits an oversized legal unit at paragraph boundaries, then Chinese sentence/clause boundaries;
5. merges only short adjacent non-legal preamble fragments with the same parent path;
6. records original line start/end, title, parent path and a deterministic content-derived chunk ID;
7. leaves every source file untouched.

Chinese FTS5 adaptation is separate in `SearchTextProcessor`. The index contains the original content in `policy_chunks` and a searchable expansion in the upstream `chunks`/`chunks_fts` tables. Expansion adds administrative aliases, domain synonyms, recognized phrases and Chinese bigrams. It never adds a policy fact. Queries receive the same normalization.

The index reuses `pi-local-rag`'s SQLite database, FTS5 schema/triggers, hash and project-local store. `chunks_vec` must remain empty, and every build asserts this invariant.

