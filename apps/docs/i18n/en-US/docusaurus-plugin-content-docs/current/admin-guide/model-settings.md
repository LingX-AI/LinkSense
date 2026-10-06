---
title: Model and generation settings
description: Manage chat, retrieval, transcription, image-understanding, and image-generation models.
---

# Model and generation settings

:::info Administrator operation
Open **Settings → Model settings**. Changes affect later turns or document processing, not running or historical work.
:::

## Provider channels

When adding a channel, choose the service provider first, then enter a name, Base URL, and API key. Selecting a provider fills in its recommended address and protocol. If no address is provided, enter the compatible service address available to your account. These defaults are starting points; verify your account, region, and the service's actual capabilities. The protocol is always visible in **Advanced settings** and can be adjusted as needed.

Use **Current channel** to switch model catalogs and choose **Edit channel** from the channel's three-dot menu to open a centered dialog. Opening an existing channel preserves its saved address and protocol. A saved key is never returned. Leave the key empty to retain it only when the provider, address, project, and region are unchanged. After changing any of those connection details, enter the key for the new connection before saving or testing.

Save the channel’s connection settings first, then use **Add model** to configure models separately. Channels without models do not add entries to the composer’s model list. The compact list shows names, types, prices, and conversation availability. Open the edit dialog to configure a model. Saving submits only that dialog’s changes; canceling lets you discard unsaved edits.

## Find models and test the connection

After saving a channel, select **Add model**, then click **Get available models** to the right of the model selector. Search by model name or ID and select a model. The selector remains disabled until models have been retrieved. If the service does not offer a model list, returns an empty list, or omits your model, choose **Enter a model manually** and enter the ID supplied by the provider.

LinkSense fills in only the name, context length, and image-input information actually returned by the service. Confirm capabilities that were not supplied. Check and enter the provider's actual prices yourself; default zero prices are for local usage estimates only. Pricing, reasoning efforts, context length, and image capabilities are always visible in the model's **Advanced settings**.

**Get available models** and **Test model connection** are separate operations: retrieving a list does not confirm that a model responds. Enter a model ID to test while editing a channel, or test the current chat model when adding or editing it. The test sends a short message. A normal, non-empty text reply confirms the connection works; no tool call is required. The test may incur a small charge and never saves settings. A successful result applies only to that connection and model at the time of the test; test again after making changes. It does not replace validation with real tasks, image understanding, or knowledge retrieval. Connection testing here is not available for embedding or ranker models; validate those in the knowledge retrieval settings described below.

During initial setup, save the first chat model with **Available in conversations** enabled. LinkSense sets it as both the conversation default and the task auto-naming model. Return to **New task**, check the model and reasoning effort, and submit a simple request to verify usage.

## Protocol modes

Protocol modes are native Responses, Responses function-tool compatibility, and Chat Completions conversion. Compatibility changes protocol shape only—it never executes tools or replays a full turn.

## Models and prices

Model IDs are unique across channels. Configure type, display name, provider, image support, reasoning efforts, and prices:

- chat models: input, cached-input, and output prices;
- embedding and ranker models: input price.

Prices use USD per million tokens and are snapshotted with future usage. A price change never recalculates history.

Set **Model context length** to a positive token count, or leave it empty for automatic detection. LinkSense uses this value for the context-window indicator and to let the runtime compact context before approaching the model limit. Enter the provider model's real capability; a larger number does not expand the upstream model.

Only chat models show the Available in conversations switch; embedding and ranker models do not. Conversation availability only controls the composer model list. It does not affect task auto naming, knowledge retrieval, reranking, or image understanding. Once chat models are configured, at least one must remain available in conversations. Hiding or deleting the default selects another conversation-available model.

Supported reasoning efforts are editable for chat models. Select one or more of Light, Medium, High, Extra high, Maximum, and Ultra. The default reasoning effort must remain in the selected set; removing the current default automatically selects the first remaining effort.

## Model order

Drag a model’s leading handle, or choose **Move up** or **Move down** from its action menu, to reorder models within the current channel. Keyboard users can press Space to pick up a handle, use the arrow keys to move, press Space to confirm, or Escape to cancel.

Use **Move channel up** or **Move channel down** under **Channel actions** to reorder channels. Changes save automatically. A failed save preserves the previous order and displays an error. The composer lists conversation-available chat models in channel order, then model order within each channel. Reordering does not change the user’s selected model.

## Conversation and task auto-naming models

At the end of the provider list, select the conversation default and the task auto-naming model separately. The conversation default must be available in conversations. Task auto naming can use any configured chat model and never reads a deployment-provided built-in naming model. Its input, cached-input, and output tokens are recorded under the Task auto naming workload; usage is marked as estimated when the provider does not return token counts.

## Memory extraction model

Select **Memory extraction model** from the existing chat models. It reuses the model's channel, credentials, and prices; no separate connection settings are needed. Conversation availability does not affect extraction. Clear the extraction selection before deleting the selected model or its channel.

**Use the current task model** uses each task's model for extraction. Extraction always uses the selected model's lowest configured supported reasoning effort, without changing the task's own effort. This selection applies only to extraction; consolidation continues to use the current task model.

Memory generation requires the user's opt-in. Changes apply to subsequently started task runtimes and preserve existing memories. Tasks belonging to one user share native memory state. The native engine uses successful-processing markers, job locks, and input changes to avoid duplicate work. Switching models or restarting does not reset that state. Failure recovery and updated history can still cause new model calls; deduplication is not a retry or spending limit.

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

## Voice transcription model

When enabled, microphone input in ordinary tasks and embedded applications uses this service. Select a provider, verify the Base URL, and enter an API key plus a model or deployment name. Azure OpenAI also requires an API version. Saved API keys are never returned; leave the field empty while editing to retain the existing key.

Available providers are Alibaba Cloud Model Studio, OpenAI, OpenAI-compatible services, Azure OpenAI, Groq, Deepgram, AssemblyAI, ElevenLabs, Rev.ai, Gladia, and fal.ai. Provider defaults are connection starting points only; model availability, region, authorization, and billing come from your provider account.

After saving, use [Voice input](../user-guide/tasks/voice-input.md) to test a short recording without sensitive data. Disabling this setting blocks new transcription requests but does not affect typed tasks.

## Image-generation model

When enabled, users can call the built-in image-generation capability from a task. Select a provider, enter the model and API key, and configure a per-image price. LinkSense records that price against the number of images actually produced for usage and credits. The provider determines the Base URL; it is not freely editable in the page.

Supported providers are Alibaba Cloud Model Studio, OpenAI, Google Gemini, Stability AI, fal.ai, Replicate, and Together AI. Alibaba Cloud Model Studio also requires a Workspace ID and region. Provider and model limits vary; one request can ask for no more than 10 images, and runtime output is capped by the current model limit.

Transparent output can be generated natively or handled automatically for suitable clean-edged subjects. Choose a model with native transparency for complex hair, fur, glass, smoke, glow, and translucent edges.

Saved API keys are never returned; leave the field empty while editing to retain the existing key. Enter a new key and verify pricing after switching providers. Use [Generate images](../user-guide/tasks/generate-images.md) for a one-image validation after configuration.
