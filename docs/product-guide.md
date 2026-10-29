# Use Cases, Deployment Choices, and Extensions

[Back to README](../README.md)

## Use Cases

| Direction | How to use LinkSense |
| --- | --- |
| Internal adoption | Give members a shared work environment, distribute maintained Knowledge, Skills, and Applications, and let IT manage access and usage. |
| Business tasks | Prepare sales proposals from product materials and templates, organize support information, and generate operational reports; connect system queries and write-back where needed. |
| Products and services | Combine domain knowledge and tools into Applications, then configure external access to embed them in websites, customer portals, or business systems. |

Business system operations depend on connected interfaces, permissions, and business rules; these must be configured for the intended task.

## Open Source. Self-hosted. Under Your Control.

Run the complete platform on your own servers, private cloud, or VPC. Inspect the source,
modify the platform, choose your models and integrations, and operate the environment on
infrastructure you control. There is no required closed enterprise runtime,
LinkSense-operated cloud control plane, or online license activation heartbeat.

With private models, local Knowledge, and local MCP services, prompts, files, Task state,
Knowledge indexes, credentials, audit records, and results can remain inside
infrastructure you control.

Configured external services may still make external network calls, so LinkSense describes
itself as **self-hosted and private-network friendly**, not formally air-gapped.

**Models:** OpenAI · Azure OpenAI · Anthropic · Google / Vertex · Alibaba · DeepSeek ·
OpenRouter · OpenAI-compatible endpoints

For internal deployment exceptions, attribution requirements, and branding permissions,
see [License](license-guide.md).

## Build with LinkSense

LinkSense provides three primary extension paths without requiring changes to LinkSense
source.

### Build a Skill

Teach AI reusable methods, workflows, domain practices, scripts, references, and
supporting resources using the native Codex Skill format.

<p align="center">
  <img src="../docs/diagrams/skill-directory-structure.svg" alt="my-skill/ contains SKILL.md, agents/openai.yaml, scripts/, references/, and assets/." width="600" />
</p>

Skills can be discovered natively by Codex or explicitly selected by users and Applications.

### Build an MCP-backed Plugin

Connect external systems and APIs through MCP, then package MCP declarations together with
Skills and supporting resources.

<p align="center">
  <img src="../docs/diagrams/plugin-package-structure.svg" alt="Plugin contains Skills, MCP declarations, scripts / resources, and .codex-plugin/plugin.json." width="339" />
</p>

For CRM, ERP, SaaS, monitoring systems, and internal APIs, MCP is generally the
recommended integration boundary.

Credentials remain separate from Plugin packages.

### Build an Interactive Application

Build purpose-specific interfaces and workflows on top of authorized LinkSense capabilities.

Interactive Applications are packaged with `manifest.json`, HTML, JavaScript, CSS, and
assets, and run inside sandboxed iframes.

Their SDK can request explicitly permitted capabilities such as user profile access,
capability discovery, Knowledge Base access, MCP Server discovery, and Task creation.

Interactive Applications are separate from normal Applications, which are primarily
configuration and capability-composition objects.
