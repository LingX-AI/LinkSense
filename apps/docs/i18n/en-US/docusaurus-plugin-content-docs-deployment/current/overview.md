---
title: Choose a deployment
description: Choose Core or Full based on Knowledge requirements and plan capacity.
slug: /deploy/
---

# Choose a deployment

LinkSense can run on your own server or private cloud. Core and Full use the same product code and differ in whether built-in Knowledge services are deployed.

## Core and Full

| Edition | Includes | Choose it when |
| --- | --- | --- |
| [Core](./core.md) | Agent workspace, task attachments, skills, plugins, MCP, applications, and organization management | You do not need built-in parsing, indexing, or retrieval for organizational Knowledge. |
| [Full](./full.md) | Core plus built-in Knowledge powered by Elasticsearch and Docling | You need to process, retrieve, and cite organizational documents. |

## Plan resources

| Edition | Evaluation starting point | Docker memory preflight |
| --- | --- | --- |
| Core | 4 vCPU and 60 GiB of free SSD space | 8 GiB |
| Full | 8 vCPU and 120 GiB of free SSD space | 10 GiB for a fresh v0.3.13 install; check the selected release manifest |

Allow for VM overhead when allocating Docker Desktop memory. On a 16 GiB Mac, start with Core and consider allocating 10–12 GB to Docker Desktop, then check the memory Docker Engine reports.

For organizational Full deployments, start capacity planning at 16 vCPU, 32 GiB of memory, and 200 GiB of free SSD space. These recommendations assume an external model API. Plan compute and GPUs for local inference separately. Test real workloads at peak concurrency, including large documents and OCR. Passing preflight does not establish peak capacity.

## Choose an installation method

- Install published Docker images: open the [Core](./core.md) or [Full](./full.md) guide. No source checkout is needed.
- Use a coding agent: give it the [repository installation guide](https://raw.githubusercontent.com/LingX-AI/linksense/main/Install.md) and your deployment goal.
- Change code or build images: follow [source development](./development.md).
- Manage an existing installation: start with [operations, repair, and upgrades](./operations.md).
