import { describe, expect, it } from "vitest";
import type { ConversationSource } from "@linksense/shared";
import { extractReferencedSources, mergeReferencedSources } from "../src/modules/conversations/referenced-sources.js";

describe("reply source links", () => {
  it("extracts Markdown, reference and plain links in reading order", () => {
    expect(extractReferencedSources(`正文 [官网 **说明**](https://example.com/guide_(v2))、[报告][report]，https://plain.test/news。然后继续。

[report]: https://reports.test/a "报告标题"
[unused]: https://unused.test
`)).toEqual([
      { url: "https://example.com/guide_(v2)", title: "官网 说明" },
      { url: "https://reports.test/a", title: "报告标题" },
      { url: "https://plain.test/news", title: null },
    ]);
  });
  it("ignores code, images, relative artifacts, credentials and non-web protocols", () => {
    expect(extractReferencedSources(`\`https://code.test\`
~~~js
const source = "https://code.test/example";
~~~
![图片](https://images.test/a.png) [产出文件](sandbox:/mnt/data/file.pdf)
[不安全](javascript:alert) [凭证](https://user:password@private.test/a) [邮件](mailto:a@example.test)
`)).toEqual([]);
  });
  it("keeps query strings and anchors distinct and retains an explicit Chinese path", () => {
    expect(extractReferencedSources(`[一](https://example.test/说明。详情?a=1#intro) [二](https://example.test/说明。详情?a=2#intro)`)).toEqual([
      { url: "https://example.test/%E8%AF%B4%E6%98%8E%E3%80%82%E8%AF%A6%E6%83%85?a=1#intro", title: "一" },
      { url: "https://example.test/%E8%AF%B4%E6%98%8E%E3%80%82%E8%AF%A6%E6%83%85?a=2#intro", title: "二" },
    ]);
  });
  it("deduplicates normalized URLs and enriches a bare link title without reordering it", () => {
    const sources = new Map<string, ConversationSource>();
    mergeReferencedSources(sources, extractReferencedSources("https://EXAMPLE.test:443/a https://other.test"));
    mergeReferencedSources(sources, extractReferencedSources("[文档](https://example.test/a) [后来的标题](https://example.test/a)"));
    expect([...sources.values()]).toEqual([
      { url: "https://example.test/a", title: "文档" },
      { url: "https://other.test/", title: null },
    ]);
  });
  it("handles empty replies and bounds long source titles", () => {
    expect(extractReferencedSources("")).toEqual([]);
    expect(extractReferencedSources(`[${"题".repeat(450)}](https://example.test)`)[0]?.title).toHaveLength(400);
  });
  it("includes referenced footnotes once and ignores unused footnote sources", () => {
    expect(extractReferencedSources(`见说明[^source]，再次引用[^source]。

[^unused]: [未引用](https://unused.test)
[^source]: [资料](https://source.test) 另见[^nested]。
[^nested]: [附录](https://appendix.test) 回到[^source]。
`)).toEqual([
      { url: "https://source.test/", title: "资料" },
      { url: "https://appendix.test/", title: "附录" },
    ]);
  });
});
