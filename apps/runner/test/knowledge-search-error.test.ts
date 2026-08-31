import { describe, expect, it } from "vitest";

import { knowledgeSearchErrorFromApi } from "../src/knowledge-search-error.js";

describe("knowledgeSearchErrorFromApi", () => {
  it("maps API validation failures to a non-retryable knowledge search error", () => {
    expect(
      knowledgeSearchErrorFromApi(400, { error_code: "VALIDATION_ERROR" }),
    ).toMatchObject({
      code: "KNOWLEDGE_SEARCH_INVALID",
      retryable: false,
      statusCode: 400,
    });
  });
});
