# ADR 0003: Local Open XML development slice

Status: implemented for local development; not a production architecture replacement.

Use JSZip (MIT or GPLv3, select MIT) and @xmldom/xmldom (MIT) to parse and modify existing PPTX packages. PptxGenJS (MIT) generates fixtures only. Runtime requires Node.js 24+ on Windows or Linux. The editing path leaves unrelated ZIP parts intact and never overwrites uploaded files.

Validated with generated 1, 15, 30 and 60 page presentations containing Chinese text, multiple runs and notes: stable IDs, text replacement across runs, ordering, hidden state, existing notes updates, export/reparse and untouched XML preservation. These tests are not PowerPoint application-open or complex-template certification.

Supported editing: directly positioned, ordinary text shapes; same-paragraph selection. Fields, line-break objects, grouped shapes and inherited positioning are read-only. Notes editing currently requires an existing notes body. Image/chart/media data remains in the package but is not editable or faithfully rendered.

Preview is a browser representation of native text and coordinates. It is explicitly labeled as a text-structure preview; it is not a slide renderer. High-fidelity rendering, theme/layout resolution, fonts, visual understanding and precise overflow checks remain prerequisites for full task 01 acceptance.

The local application uses an atomic JSON snapshot and immutable object files so that it can run without external infrastructure. A process-local transaction queue serializes writes. Do not run multiple instances against the same directory. PostgreSQL migrations, independent jobs, remote object storage and authentication remain necessary before deployment.
