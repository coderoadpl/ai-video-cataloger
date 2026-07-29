# ADR-0010: Analysis variants use configuration identity and shared artifacts

Date: 2026-08-03 · Status: accepted (owner decisions, 2026-08-02) · Refines
[architecture.md Delta 3](../architecture.md#delta-3--persistence) and
[ADR-0002](0002-global-catalog-layer.md).

## Context

The catalog previously stored one analysis per content fingerprint. A second
run of the same content was skipped unless `--force` replaced the existing
result, even when the analyzer, transcription source, frame count, output
language, or prompt had changed. Supporting several analyses per file requires
stable configuration identity, artifact reuse without changing the established
name-based paths, and a skip rule that addresses one variant rather than the
whole file.

## Decision

### 1. Configuration identity is closed and content-derived

An analysis variant is identified by `(fingerprint, configId)`. The `configId`
is `cfg_` plus the first 12 hexadecimal characters of SHA-256 over canonical
JSON for a normalized config descriptor. Canonical JSON sorts keys and contains
no insignificant whitespace. Defaults are materialized and legacy analyzer
aliases fold into their explicit provider descriptors before hashing.

The strict descriptor includes:

- analyzer `family`, `providerId`, and the family's result-shaping fields:
  `model` or `modelTag`, `maxImageDetail`, `promptStyle`, and
  `reasoningEffort` where applicable;
- the transcription source: `whisper_mode` and its local model or API endpoint
  and model, or the native Gemini provider and model;
- `frames` except for `gemini-native`, which extracts no frames;
- `output_language`;
- `tag_language`, omitted only when it and `output_language` both resolve to
  `auto` — the single state whose analyzer prompt is byte-identical to runs made
  before the key existed, so those descriptors keep their historical ids;
- `promptVersion`, an integer next to each prompt template that is bumped when
  the template changes.

Secrets and operational settings are excluded. `apiKeyRef` and credential
values cannot enter identity. `whisper_binary_path` is machine-local. `timeout`,
`skip_rename`, `faces_enabled`, `ui_language`, `gemini_batch_mode`, and
`gemini_monthly_budget_usd` do not shape the analysis result. A new config key
must be explicitly classified before it can join or remain outside identity.

Pre-feature analyses use the reserved `legacy` sentinel. The app cannot safely
derive a real configId because their transcription and frame inputs were never
persisted.

### 2. Shared inputs are content-addressed and legacy names project selection

Shared frames and transcripts are stored by fingerprint and the settings that
shape their bytes:

```text
.ai-video-cataloger/artifacts/frames/{fingerprint}/{framesKey}/frame-NNN.jpg
.ai-video-cataloger/artifacts/transcripts/{fingerprint}/{transcriptKey}.txt|.json
```

Variant-specific outputs are stored separately:

```text
.ai-video-cataloger/variants/{fingerprint}/{configId}/summary.txt|summary.json|debug.log
```

The established `frames/{base}/`, `transcripts/{base}.txt`, and
`summaries/{base}.*` paths project the selected variant. Projection uses hard
links with a copy fallback and is replaced atomically when selection changes.
A `legacy` variant carries no artifacts, so it cannot be projected; processing
a new configuration for such a file takes selection instead of leaving the
name-based paths empty.

This is chosen over variant-only directories with legacy names pinned to the
first result, because those names would stop meaning the file's active analysis.
It is also chosen over keeping a complete input copy inside every variant,
because repeated frame extraction and transcription would waste storage and
repeat the most expensive pipeline work.

### 3. Deduplication and force operate per pair

The global-index skip is evaluated on `(fingerprint, configId)`. A run skips
when that pair exists, but a different configId for the same content runs and
adds another variant. `--force` bypasses the skip and replaces only the
addressed pair; it does not delete or overwrite other variants.

This is chosen over fingerprint-only skipping, which would require `--force`
for every new configuration and would destroy the previous result. An
interactive prompt is not an option because processing has a non-interactive
NDJSON contract. The CLI therefore remains single-configuration-per-run;
multiple variants come from multiple runs.

## Consequences

- Configuration identity is portable and deterministic, with golden vectors
  guarding it from accidental drift. Changing only `output_language`,
  `tag_language`, or `promptVersion` intentionally creates a new variant.
- Files remain one row per fingerprint, so duplicate copies of the same content
  share their variant set and explicit selection.
- Shared inputs are reused only after their key and on-disk presence are
  verified. Removing a variant removes a shared artifact only after its last
  reference disappears.
- Search and the name-based paths expose exactly the resolved selected variant.
- A script that assumed every second run of the same content was a no-op now
  sees processing when the configuration changed. Existing NDJSON changes are
  additive so consumers that ignore unknown fields and steps continue to work.
