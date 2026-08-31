---
title: Model and retrieval model settings
description: Manage model providers, prices, reasoning efforts, and knowledge retrieval models.
---

# Model and retrieval model settings

:::info Administrator operation
Open **Settings → Model settings**. Changes affect later turns or document processing, not running or historical work.
:::

## Provider channels

Configure a name, Base URL, API key, protocol mode, and models. A saved key is not returned; an empty edit preserves it.

Protocol modes are native Responses, Responses function-tool compatibility, and Chat Completions conversion. Compatibility changes protocol shape only—it never executes tools or replays a full turn.

## Models and prices

Model IDs are unique across channels. Configure type, display name, provider, image support, reasoning efforts, and prices:

- chat models: input, cached-input, and output prices;
- embedding and ranker models: input price.

Prices use CNY per million tokens and are snapshotted with future usage. A price change never recalculates history.

Only chat models show the Available in conversations switch; embedding and ranker models do not. Conversation availability only controls the composer model list. It does not affect task auto naming, knowledge retrieval, reranking, or image understanding. At least one chat model must remain available in conversations, and each channel must retain one model. Hiding or deleting the default selects another conversation-available model.

Supported reasoning efforts are editable for chat models. Select one or more of Light, Medium, High, Extra high, Maximum, and Ultra. The default reasoning effort must remain in the selected set; removing the current default automatically selects the first remaining effort.

## Conversation and task auto-naming models

At the end of the provider list, select the conversation default and the task auto-naming model separately. The conversation default must be available in conversations. Task auto naming can use any configured chat model and never reads a deployment-provided built-in naming model. Its input, cached-input, and output tokens are recorded under the Task auto naming workload; usage is marked as estimated when the provider does not return token counts.

## Initial user token usage

**Initial user token usage** presets per-user usage for users created manually or imported from Excel. You can set weekly and monthly usage separately:

- Values use million tokens.
- Positive numbers with up to 6 decimal places are accepted.
- Leave a field blank so new users receive no automatic usage setting for that period.
- Changes affect only users created or imported later; existing users are not rewritten.

Adjust existing users from **Groups & users → Users**, either individually or in batches. Usage settings control whether a user can start new tasks; already running tasks are not force-stopped after usage remaining reaches 0.

## Knowledge retrieval models

Select one configured embedding model and an optional ranker. Conversation availability does not affect these system models. Saving performs real service and vector-dimension validation.

:::warning Changing the embedding model
The change invalidates every existing knowledge index immediately. Retrieval remains unavailable until a full rebuild completes in System Health. Plan a maintenance window first.
:::

Without a ranker, or when ranker calls fail, LinkSense uses equal-weight RRF results.

## Image understanding

Select a configured chat model marked as supporting image understanding. Conversation availability does not affect image understanding. Saving probes image input, structured output, and disabled-reasoning behavior. It affects only new processing or rebuilds.
