---
title: View task progress, artifacts, and sources
description: Use activity and the task overview to track subagents, artifact files, and external sources.
---

# View task progress, artifacts, and sources

## Activity

A running task shows visible activity in time order, such as reasoning progress, plans, tool actions, context compaction, and status changes. Expand an item to view details that LinkSense is allowed to display. Secrets, internal addresses, and protected data are hidden.

Network reconnection, a page refresh, or redelivery of events for the same turn continues that turn; it does not mean the task ran a second time. For long histories, LinkSense loads earlier exchanges in pages. Scroll or select a history group to continue viewing them.

## Task overview

The overview at the top of a task brings together:

- subagents, their current states, and completion count;
- registered artifact files, with preview or download for supported types;
- external web sources identified in assistant responses.

If a task did not use subagents, generate files, or include external sources, the related area is empty. Use the activity below the messages for plans and tool details.

## External sources and knowledge citations

The **Sources** list collects and deduplicates external web links from assistant responses. Selecting a source opens the original page in a new window. If no page title is available, the URL is shown. This list helps you return to the source; it is not an additional endorsement of external content by LinkSense.

Knowledge-base citations use numbered markers in the response and can open a cited excerpt or source location. They are separate from external web sources. See [Use knowledge bases and review citations](../knowledge-bases/use-and-citations.md).

## Verify important results

- Check that conclusions match the cited sources and attached files.
- For decisions affecting finance, legal matters, health, safety, or production systems, open and review the primary source.
- Download important artifacts to an organization-approved location. Temporary download URLs are not permanent sharing links.

See [Files, previews, and artifacts](./files-and-results.md) for preview and download behavior.
