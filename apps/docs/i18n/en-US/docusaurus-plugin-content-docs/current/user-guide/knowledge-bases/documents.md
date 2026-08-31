---
title: Upload and manage knowledge-base documents
description: Upload files or folders, follow processing, and maintain document versions.
---

# Upload and manage knowledge-base documents

## Upload files or folders

Choose files or a folder from the knowledge-base detail page. Folder upload preserves paths below the selected root; empty directories are not stored.

The local pipeline accepts PDF, DOCX, XLSX, PPTX, ODT, ODS, ODP, TXT, Markdown, HTML, CSV, and PNG, JPEG, TIFF, BMP, or WebP images. Unsupported files are skipped with an explanation.

Default deployment limits are 200 MiB per file, 100 files per batch, and 10 GiB per knowledge base. Always use the current limits returned by the page.

## Processing stages

Documents move through validation, queueing, parsing, chunking, optional image understanding, parent construction, embedding, indexing, and activation. Only a **Ready** version is retrievable.

Review the failed stage and retry after resolving the cause. Reprocessing runs the full pipeline from the stored original.

## Versions, names, and directories

- Replacing a file creates a version and activates it only after success.
- Historical citations remain fixed to the exact version used.
- Renaming changes display metadata, not content.
- Directories and flat or hierarchical views help organize entries.

## Preview and download

The document page offers parsed and original read-only views. Originals are fetched through authorized LinkSense endpoints, never arbitrary URLs; HTML originals are handled as safe content. Download remains a separate action.

:::warning Deletion
Deletion uses a controlled cleanup process. After permanent cleanup, a historical citation retains only safe historical names and location summaries; content, preview, and download are unavailable.
:::
