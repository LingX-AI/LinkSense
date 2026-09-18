import { describe, expect, it } from "vitest";
import { officeAnnotationInputSchema, officeAnnotationDisplaySchema, buildOfficeAnnotationDisplay, officeAnnotationRequestText, userMessageDisplaySchema } from "../src/conversations.js";

const annotation = {
  kind: "application_annotation", development_id: "20000000-0000-4000-8000-000000000001",
  package_id: "20000000-0000-4000-8000-000000000002", source_hash: "a".repeat(64), page_path: "index.html",
  annotations: [{ request: "把按钮改成蓝色", elements: [{ selector: "#submit", dom_path: [0], tag_name: "button", class_names: [], attributes: {}, text: "提交", outer_html: "<button>提交</button>", bounds: { x: 0, y: 0, width: 20, height: 20 } }] }],
};

describe("application annotations", () => {
  it("accepts bounded app selections and projects only safe display information", () => {
    const input = officeAnnotationInputSchema.parse(annotation);
    const display = buildOfficeAnnotationDisplay(input, "主题调研");
    expect(display).toEqual({ kind: "application_annotation", development_id: annotation.development_id, application_name: "主题调研", package_id: annotation.package_id, source_hash: annotation.source_hash, page_path: "index.html", annotations: [{ request: "把按钮改成蓝色", selection_count: 1 }], annotation_count: 1 });
    expect(officeAnnotationDisplaySchema.parse(display)).toEqual(display);
    expect(userMessageDisplaySchema.parse(display)).toEqual(display);
    expect(officeAnnotationRequestText(input)).toBe("把按钮改成蓝色");
    expect(JSON.stringify(display)).not.toMatch(/submit|outer_html|dom_path/);
  });
  it.each(["../index.html", "/index.html", "https://example.com/", "index.html?token=secret", "a\\b.html", "a/./index.html", "a/%2e%2e/b.html"])("rejects unsafe preview paths: %s", (page_path) => {
    expect(officeAnnotationInputSchema.safeParse({ ...annotation, page_path }).success).toBe(false);
  });
  it("continues accepting existing HTML annotations without app fields", () => {
    const input = officeAnnotationInputSchema.parse({ kind: "html_annotation", file_id: annotation.development_id, annotations: annotation.annotations });
    expect(buildOfficeAnnotationDisplay(input, "page.html").kind).toBe("html_annotation");
  });
});
