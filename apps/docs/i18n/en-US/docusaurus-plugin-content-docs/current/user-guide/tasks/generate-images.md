---
title: Generate images
description: Describe an image in a task, then preview or download the registered LinkSense artifact.
---

# Generate images

After an administrator configures and enables an image-generation model, describe the image you want in an ordinary task. LinkSense uses its built-in image-generation capability and registers successful output as task artifacts.

## Write a clear request

Include:

- subject: the person, product, scene, or graphic elements;
- style: photography, illustration, 3D, poster, icon, and so on;
- composition: viewpoint, layout, spacing, colors, and lighting;
- text: any short copy that must appear and where it belongs;
- output: image count, dimensions or orientation, and whether the background must be transparent.

For example: “Generate one 1024×1024 minimal product icon, keep the full subject inside the canvas with padding on every side, and use a transparent background.” LinkSense normally requests one image when no count is given. The configured provider and model may impose lower count or size limits.

## Transparent backgrounds

Explicitly request a transparent background for stickers, icons, product cutouts, or compositing assets. Simple subjects with clean edges can be handled automatically. Hair, fur, glass, smoke, glow, and translucent materials require native model support for high-quality transparent edges. If the current model cannot provide that quality, LinkSense reports the limitation instead of silently substituting a lower-quality result.

## View results and cost

Generated images appear as task artifacts for preview or download. You can also find them under **Library → Task artifacts**. The administrator configures a per-image price for the generation service; the number of images actually generated contributes to usage and credits.

## If generation fails

- **Not configured or disabled:** ask an administrator to configure image generation.
- **Provider rejected the request:** review the prompt, model, or administrator configuration before submitting a revised request.
- **Service unavailable:** try again later.
- **Transparent background unsupported:** use a model with native transparency, or request a regular background if the edge-quality requirement allows it.
- If the page reports an artifact-registration or usage-recording failure, do not immediately generate again. The provider may already have processed and charged for the request; ask an administrator to verify it first.

See [Files, previews, and artifacts](./files-and-results.md) for preview, download, and temporary-link behavior.
