# AI asset generation

User approved adding LLM generation alongside local templates. Reuse Core model profiles, including session-only credentials, and its provider-neutral LLM client. Select the planning route/default or an explicit model without modifying routes. A plugin-owned managed-runtime entry registers a preview-only API against pinned Core; external Core servers need to provide that endpoint separately.

Implementation:
- `scripts/runtime/managed_entry.py`: model selection, bounded workspace context, strict output validation, generated stage IDs, per-workspace concurrency guard and safe errors.
- Bridge: start the extension, allow generation POST, give it a 150-second deadline, omit asset invalidations for previews.
- Panel: optional AI controls for names/full drafts, model/requirements/context selection, preview and explicit per-field adoption; protect filled fields by default.
- Verify with mocked model calls, component tests, managed-runtime lifecycle tests and builds. No paid generation or live asset writes during tests.

Verification: panel and bridge builds passed; 16 targeted frontend tests, 7 Python tests, and 12 managed-runtime lifecycle tests passed. An isolated real Core process passed stdio startup and authenticated health checks. Model calls in tests used fixtures; no live credentials or paid model requests were used. Package 0.2.11-dev.2 contains matching panel, bridge and runtime extension bytes. Lifecycle and loopback checks required execution outside the sandbox.
