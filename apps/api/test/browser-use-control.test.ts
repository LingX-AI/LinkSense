import { expect, it } from "vitest";
import { controlMessageSchema, cursorPath, excludeControlSubtree, reduceCursorMotion } from "../browser-extension/control-protocol.js";

const request_id = "40000000-0000-4000-8000-000000000001";
it("generates a smooth bounded path that ends at the actual native click coordinate", () => {
  const path = cursorPath({ x: 10, y: 20 }, { x: 310, y: 220 });
  expect(path).toHaveLength(10);
  expect(path.at(-1)).toEqual({ x: 310, y: 220 });
  for (const [index, point] of path.entries()) {
    expect(point.x).toBeGreaterThanOrEqual(index ? path[index - 1]!.x : 10);
    expect(point.y).toBeGreaterThanOrEqual(index ? path[index - 1]!.y : 20);
    expect(point.x).toBeLessThanOrEqual(310);
    expect(point.y).toBeLessThanOrEqual(220);
  }
  expect(cursorPath({ x: 5, y: 8 }, { x: 5, y: 8 })).toEqual(Array(10).fill({ x: 5, y: 8 }));
});
it("accepts only bounded presentation commands and never exposes typed text", () => {
  const valid = { type: "linksense-control", action: "move", request_id, x: 100, y: 200, duration: 30 };
  expect(controlMessageSchema.parse(valid)).toEqual(valid);
  for (const input of [
    { ...valid, x: -1 }, { ...valid, duration: 5000 }, { ...valid, action: "evaluate" },
    { ...valid, text: "private-input" }, { ...valid, x: undefined },
  ]) expect(controlMessageSchema.safeParse(input).success).toBe(false);
});
it("excludes only the extension's accessibility subtree, including cycles and repeated child references", () => {
  const nodes = [
    { nodeId: "root", backendDOMNodeId: 1, childIds: ["page", "control"] },
    { nodeId: "page", backendDOMNodeId: 2 },
    { nodeId: "control", backendDOMNodeId: 3, childIds: ["stop", "label"] },
    { nodeId: "stop", backendDOMNodeId: 4, childIds: ["control"] },
    { nodeId: "label", backendDOMNodeId: 5 },
  ];
  expect(excludeControlSubtree(nodes, 3).map(node => node.nodeId)).toEqual(["root", "page"]);
  expect(excludeControlSubtree(nodes, undefined)).toBe(nodes);
});
it("skips animation for hidden tabs and reduced-motion users without delaying native input", () => {
  expect(reduceCursorMotion(true, false)).toBe(false);
  expect(reduceCursorMotion(true, true)).toBe(true);
  expect(reduceCursorMotion(false, false)).toBe(true);
});
