---
title: Model and retrieval model settings
description: Manage model providers, prices, reasoning efforts, and knowledge retrieval models.
---

# Model and retrieval model settings

:::info Administrator operation
Open **Settings → Model settings**. Changes affect later turns or document processing, not running or historical work.
:::

## Provider channels

Configure a name, Base URL, API key, and protocol mode. Add models separately after saving. Use **Current channel** to switch model catalogs and choose **Edit channel** from the channel’s three-dot menu to open a centered dialog. A saved key is not returned; an empty edit preserves it.

Save the channel’s connection settings first, then use **Add model** to configure models separately. Channels without models do not add entries to the composer’s model list. The compact list shows names, types, prices, and conversation availability. Open the edit dialog to configure a model. Saving submits only that dialog’s changes; canceling lets you discard unsaved edits.

Protocol modes are native Responses, Responses function-tool compatibility, and Chat Completions conversion. Compatibility changes protocol shape only—it never executes tools or replays a full turn.

## Models and prices

Model IDs are unique across channels. Configure type, display name, provider, image support, reasoning efforts, and prices:

- chat models: input, cached-input, and output prices;
- embedding and ranker models: input price.

Prices use CNY per million tokens and are snapshotted with future usage. A price change never recalculates history.

Only chat models show the Available in conversations switch; embedding and ranker models do not. Conversation availability only controls the composer model list. It does not affect task auto naming, knowledge retrieval, reranking, or image understanding. Once chat models are configured, at least one must remain available in conversations. Hiding or deleting the default selects another conversation-available model.

Supported reasoning efforts are editable for chat models. Select one or more of Light, Medium, High, Extra high, Maximum, and Ultra. The default reasoning effort must remain in the selected set; removing the current default automatically selects the first remaining effort.

## Model order

Drag a model’s leading handle, or choose **Move up** or **Move down** from its action menu, to reorder models within the current channel. Keyboard users can press Space to pick up a handle, use the arrow keys to move, press Space to confirm, or Escape to cancel.

Use **Move channel up** or **Move channel down** under **Channel actions** to reorder channels. Changes save automatically. A failed save preserves the previous order and displays an error. The composer lists conversation-available chat models in channel order, then model order within each channel. Reordering does not change the user’s selected model.

## Conversation and task auto-naming models

At the end of the provider list, select the conversation default and the task auto-naming model separately. The conversation default must be available in conversations. Task auto naming can use any configured chat model and never reads a deployment-provided built-in naming model. Its input, cached-input, and output tokens are recorded under the Task auto naming workload; usage is marked as estimated when the provider does not return token counts.

## User quotas

Configure user quotas in the separate [Quota management](./quota-settings.md) page, in credits.

## Knowledge retrieval models

Select one configured embedding model and an optional ranker. Conversation availability does not affect these system models. Saving performs real service and vector-dimension validation.

:::warning Changing the embedding model
The change invalidates every existing knowledge index immediately. Retrieval remains unavailable until a full rebuild completes in System Health. Plan a maintenance window first.
:::

Without a ranker, or when ranker calls fail, LinkSense uses equal-weight RRF results.

## Image understanding

Select a configured chat model marked as supporting image understanding. Conversation availability does not affect image understanding. Saving probes image input, structured output, and disabled-reasoning behavior. It affects only new processing or rebuilds.
