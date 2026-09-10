---
title: Manage personal plugins and Skills
description: Import ZIP packages, create Skills, and submit immutable releases for review.
---

# Manage personal plugins and Skills

Personal capabilities belong to you and are not automatically visible to other users.

## Import a ZIP package

1. Open **Plugin Center → Personal** and choose **Add capability**.
2. Select a local ZIP package.
3. Wait while LinkSense parses its source, files, manifest, and risk declarations.
4. Review the preview and confirm the risks before installation.

LinkSense runs a deterministic supply-chain scan over readable instructions, scripts, and configuration files in the package. Findings include a severity, file, and line. The result is bound to the current content hash and scanner version; packages with critical findings cannot be installed or submitted for publication, and changed content requires a new preview.

The preview expires. Repeat the check if it does, and never install an untrusted package.

## Create a Skill

Choose the manual Skill option and enter a complete `SKILL.md`. LinkSense previews the content and declarations before installation.

A Skill generated in a task must first be validated and registered as a complete downloadable ZIP. It is installed only after your explicit confirmation.

## Manage lifecycle

- Disabling excludes the capability from new tasks.
- Updating performs the source and risk checks again.
- Deleting permanently removes the capability, configuration, and credential bindings.
- Historical records retain only the version and source facts needed for traceability.

## Publish

Choose an owned capability in **My publications**, add release notes, and submit it. LinkSense creates an immutable snapshot for administrator review; later changes to your personal copy do not alter the snapshot.

Each release requires a separate decision. You may withdraw a pending release. After approval, the release becomes the current Plugin Center version.
