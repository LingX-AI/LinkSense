import { z } from "zod";

const pixel = z.number().finite().min(0).max(32768);
export const controlMessageSchema = z.strictObject({
  type: z.literal("linksense-control"),
  request_id: z.uuid(),
  action: z.enum(["show", "move", "click", "type", "scroll", "idle", "hide"]),
  status: z.enum(["working", "observing", "clicking", "typing", "scrolling"]).optional(),
  x: pixel.optional(),
  y: pixel.optional(),
  duration: z.number().int().min(0).max(1000).default(0),
}).refine(message => message.action !== "move" || (message.x !== undefined && message.y !== undefined));
export type ControlMessage = z.infer<typeof controlMessageSchema>;
export const controlReplySchema = z.object({
  applied: z.boolean(),
  reduced_motion: z.boolean().optional(),
  stopped: z.boolean().optional(),
});
export type CursorPoint = { x: number; y: number };

export function reduceCursorMotion(visible: boolean, preference: boolean): boolean {
  return !visible || preference;
}

export function cursorPath(from: CursorPoint, to: CursorPoint): CursorPoint[] {
  return Array.from({ length: 10 }, (_value, index) => {
    const progress = (index + 1) / 10;
    const eased = progress * progress * (3 - 2 * progress);
    return { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased };
  });
}

export function excludeControlSubtree<T extends { nodeId: string; backendDOMNodeId?: number | undefined; childIds?: string[] | undefined }>(nodes: T[], backendId: number | undefined): T[] {
  if (backendId === undefined) return nodes;
  const index = new Map(nodes.map(node => [node.nodeId, node]));
  const pending = nodes.filter(node => node.backendDOMNodeId === backendId).map(node => node.nodeId);
  const hidden = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (hidden.has(id)) continue;
    hidden.add(id);
    pending.push(...index.get(id)?.childIds ?? []);
  }
  return nodes.filter(node => !hidden.has(node.nodeId));
}
