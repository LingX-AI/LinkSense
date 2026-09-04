import imageGenerationSource from "@/features/admin/image-generation-settings-form.tsx?raw"
import imageUnderstandingSource from "@/features/admin/image-understanding-settings-form.tsx?raw"
import knowledgeModelsSource from "@/features/admin/knowledge-model-settings-form.tsx?raw"
import modelProviderSource from "@/features/admin/model-provider-settings-form.tsx?raw"
import voiceTranscriptionSource from "@/features/admin/voice-transcription-settings-form.tsx?raw"
import credentialPagesSource from "@/pages/credential-pages.tsx?raw"
import mcpPagesSource from "@/pages/mcp-pages.tsx?raw"
import { describe, expect, it } from "vitest"

describe("settings form accessibility", () => {
  it("gives provider and model controls stable form names", () => {
    expect(imageGenerationSource).toContain('name="image-generation-api-key"')
    expect(imageUnderstandingSource).toContain(
      'name="image-understanding-model"'
    )
    expect(knowledgeModelsSource).toContain('name="knowledge-embedding-model"')
    expect(modelProviderSource).toContain(
      "name={`${model.formKey}-context-window`}"
    )
    expect(voiceTranscriptionSource).toContain(
      'name="voice-transcription-api-key"'
    )
  })

  it("gives credential and MCP editor controls stable form names", () => {
    expect(credentialPagesSource).toContain('name="credential-name"')
    expect(credentialPagesSource).toContain(
      "name={`credential-secret-fields[${index}].value`}"
    )
    expect(mcpPagesSource).toContain('name="mcp-transport"')
    expect(mcpPagesSource).toContain('name="mcp-stdio-configuration"')
  })

  it("exposes pending saves to assistive technology", () => {
    for (const source of [
      imageGenerationSource,
      imageUnderstandingSource,
      knowledgeModelsSource,
      modelProviderSource,
      voiceTranscriptionSource,
      credentialPagesSource,
      mcpPagesSource,
    ]) {
      expect(source).toContain("aria-busy=")
      expect(source).toContain("<Spinner")
    }
  })
})
