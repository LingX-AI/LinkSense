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

Enter the Skill identifier first, followed by an optional display name. LinkSense generates a readable title from the identifier, such as “Meeting Notes” for `meeting-notes`. You can replace it with a name containing Chinese characters and spaces, or clear it. Once you edit or clear the display name, changing the identifier will not overwrite your choice. Display names support up to 64 characters and do not change the identifier used to invoke the Skill.

Imported Skills retain their display names when provided. Otherwise, LinkSense shows a readable title based on the identifier. Existing Skills do not need to be imported again.

A Skill generated in a task must first be validated and registered as a complete downloadable ZIP. It is installed only after your explicit confirmation.

## Manage lifecycle

- Disabling excludes the capability from new tasks.
- Updating performs the source and risk checks again.
- Deleting permanently removes the capability, configuration, and credential bindings.
- Historical records retain only the version and source facts needed for traceability.

## Publish

Choose an owned capability in **My publications**, add release notes, and submit it. LinkSense creates an immutable snapshot for administrator review; later changes to your personal copy do not alter the snapshot.

Each release requires a separate decision. You may withdraw a pending release. After approval, the release becomes the current Plugin Center version.
