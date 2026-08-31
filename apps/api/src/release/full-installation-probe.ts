import { Readable } from "node:stream"
import { pathToFileURL } from "node:url"

import { parseConfig, requireFullAppConfig } from "../config.js"
import {
  DoclingServeClient,
  extractDoclingArchive,
  readExtractedDoclingArchive,
} from "../modules/knowledge-processing/docling.js"
import { projectKnowledgeProcessingConfig } from "../modules/knowledge-processing/config.js"

const rapidOcrProbePng = Buffer.from(
  "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",
  "base64",
)

type FullProbeClient = Pick<
  DoclingServeClient,
  | "verifyContract"
  | "submitConversion"
  | "waitForSuccess"
  | "getConversionResult"
  | "verifyHybridChunker"
>

export async function runFullInstallationProbe(
  client: FullProbeClient,
  tokenizer: string,
  maxTokens: number,
): Promise<void> {
  await client.verifyContract()
  const submitted = await client.submitConversion(
    {
      filename: "linksense-rapidocr-zh-en.png",
      contentType: "image/png",
      openStream: async () => Readable.from(rapidOcrProbePng),
    },
    { documentTimeoutSeconds: 180, ocrEnabled: true },
  )
  await client.waitForSuccess({
    taskId: submitted.task_id,
    deadlineEpochMs: Date.now() + 300_000,
  })
  const result = await client.getConversionResult(submitted.task_id)
  let projectedText: string
  if (result.kind === "direct") {
    projectedText = [
      result.result.document.md_content ?? "",
      JSON.stringify(result.result.document.json_content),
    ].join("\n")
  } else {
    const extracted = await extractDoclingArchive(result.stream)
    try {
      const archive = await readExtractedDoclingArchive(extracted)
      projectedText = `${archive.markdown}\n${JSON.stringify(archive.json)}`
    } finally {
      await extracted.cleanup()
    }
  }
  if (!/linksense/iu.test(projectedText) || !/[\u3400-\u9fff]/u.test(projectedText)) {
    throw new Error("RapidOCR did not preserve the English and Chinese probe text")
  }
  await client.verifyHybridChunker({ tokenizer, maxTokens })
}

async function main(): Promise<void> {
  const appConfig = requireFullAppConfig(parseConfig())
  const config = projectKnowledgeProcessingConfig(appConfig)
  const client = new DoclingServeClient({
    ...config.docling,
    hybridProbe: {
      tokenizer: config.chunking.tokenizer,
      maxTokens: config.chunking.childMaxTokens,
    },
  })
  await runFullInstallationProbe(
    client,
    config.chunking.tokenizer,
    config.chunking.childMaxTokens,
  )
  process.stdout.write("Full release probe passed.\n")
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    process.stderr.write("Full release probe failed. Inspect the Docling and API service logs.\n")
    process.exitCode = 1
  })
}
