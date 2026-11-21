/**
 * Architecture maps for the Tech overview page: types, layout, edge routing, highlight sets and
 * a validator. The map data lives in `components/TechOverviewPage/maps.ts`; this file is pure.
 */

export type FlowId = "live" | "depth" | "analysis" | "alerts" | "planned";

/** india / ref: exchanges (allowed in India vs reference market). bus: a tall router bar. */
export type NodeKind = "india" | "ref" | "ext" | "infra" | "fmt" | "svc" | "py" | "page" | "bus";

export interface ArchLane {
  id: string;
  label: string;
  w: number;
}

export interface ArchNode {
  id: string;
  lane: string;
  y: number;
  /** Height; defaults to NODE_H. */
  h?: number;
  title: string;
  sub: string;
  kind: NodeKind;
  planned?: boolean;
  desc: string;
  /** Repo-relative paths (a trailing "/" marks a folder). Checked to exist by the tests. */
  files?: string[];
  /** Hosts, URLs or routes this node talks to (not checked). */
  endpoints?: string[];
  /** Id of the more detailed map this node opens. */
  detail?: string;
}

export interface ArchEdge {
  from: string;
  to: string;
  flows: FlowId[];
  label?: string;
}

export interface ArchRegion {
  label: string;
  from: string;
  to: string;
  y: number;
  h: number;
}

export interface ArchMap {
  id: string;
  title: string;
  /** One or two sentences shown under the title. */
  summary: string;
  lanes: ArchLane[];
  regions?: ArchRegion[];
  nodes: ArchNode[];
  edges: ArchEdge[];
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedNode extends Box {
  id: string;
  lane: string;
  bus: boolean;
}

export interface MapLayout {
  width: number;
  height: number;
  lanes: Record<string, { x: number; w: number; label: string }>;
  nodes: Record<string, PlacedNode>;
  regions: (Box & { label: string })[];
}

export const NODE_H = 46;
export const LANE_GAP = 50;
const PAD = 14;
const REGION_PAD = 12;

export function layoutMap(map: ArchMap): MapLayout {
  const lanes: MapLayout["lanes"] = {};
  let x = PAD;
  for (const lane of map.lanes) {
    lanes[lane.id] = { x, w: lane.w, label: lane.label };
    x += lane.w + LANE_GAP;
  }
  const width = x - LANE_GAP + PAD;
  const nodes: MapLayout["nodes"] = {};
  let bottom = 0;
  for (const n of map.nodes) {
    const lane = lanes[n.lane];
    if (!lane) continue;
    const h = n.h ?? NODE_H;
    nodes[n.id] = {
      id: n.id,
      lane: n.lane,
      bus: n.kind === "bus",
      x: lane.x,
      y: n.y,
      w: lane.w,
      h,
    };
    bottom = Math.max(bottom, n.y + h);
  }
  const regions = (map.regions ?? []).flatMap((r) => {
    const a = lanes[r.from];
    const b = lanes[r.to];
    if (!a || !b) return [];
    bottom = Math.max(bottom, r.y + r.h);
    const rx = a.x - REGION_PAD;
    return [{ label: r.label, x: rx, y: r.y, w: b.x + b.w + REGION_PAD - rx, h: r.h }];
  });
  return { width, height: bottom + 24, lanes, nodes, regions };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Point where an edge meets a node's side: a bus meets at the other end's height. */
function sideY(n: PlacedNode, otherCenter: number): number {
  return n.bus ? clamp(otherCenter, n.y + 12, n.y + n.h - 12) : n.y + n.h / 2;
}

/** Cubic Bézier from `s` to `t`: right→left when moving right, vertical within a lane. */
export function edgePath(s: PlacedNode, t: PlacedNode): string {
  const sc = s.y + s.h / 2;
  const tc = t.y + t.h / 2;
  if (s.lane === t.lane) {
    const down = t.y > s.y;
    const cx = s.x + s.w / 2;
    const y1 = down ? s.y + s.h : s.y;
    const y2 = down ? t.y : t.y + t.h;
    const k = (y2 - y1) / 2;
    return `M${r1(cx)},${r1(y1)} C${r1(cx)},${r1(y1 + k)} ${r1(cx)},${r1(y2 - k)} ${r1(cx)},${r1(y2)}`;
  }
  const forward = t.x > s.x;
  const x1 = forward ? s.x + s.w : s.x;
  const x2 = forward ? t.x : t.x + t.w;
  const y1 = sideY(s, tc);
  const y2 = sideY(t, sc);
  const k = Math.max(26, Math.abs(x2 - x1) / 2) * (forward ? 1 : -1);
  return `M${r1(x1)},${r1(y1)} C${r1(x1 + k)},${r1(y1)} ${r1(x2 - k)},${r1(y2)} ${r1(x2)},${r1(y2)}`;
}

export interface Highlight {
  nodes: ReadonlySet<string>;
  edges: ReadonlySet<number>;
}

/** A node, its edges and the nodes at their other ends. */
export function neighbourhood(map: ArchMap, id: string): Highlight {
  const nodes = new Set([id]);
  const edges = new Set<number>();
  map.edges.forEach((e, i) => {
    if (e.from === id || e.to === id) {
      edges.add(i);
      nodes.add(e.from);
      nodes.add(e.to);
    }
  });
  return { nodes, edges };
}

/** Every edge carrying `flow` and the nodes it joins. */
export function flowHighlight(map: ArchMap, flow: FlowId): Highlight {
  const nodes = new Set<string>();
  const edges = new Set<number>();
  map.edges.forEach((e, i) => {
    if (e.flows.includes(flow)) {
      edges.add(i);
      nodes.add(e.from);
      nodes.add(e.to);
    }
  });
  return { nodes, edges };
}

/** Flows that appear in a map, in a fixed order (planned last). */
export function flowsIn(map: ArchMap): FlowId[] {
  const order: FlowId[] = ["live", "depth", "analysis", "alerts", "planned"];
  const used = new Set(map.edges.flatMap((e) => e.flows));
  return order.filter((f) => used.has(f));
}

export function progress(map: ArchMap): { built: number; planned: number } {
  const planned = map.nodes.filter((n) => n.planned).length;
  return { built: map.nodes.length - planned, planned };
}

/** Diagram scale that fits `available` px, never below `min` (then the box scrolls). */
export function fitScale(available: number, width: number, min = 0.6, max = 1.1): number {
  if (width <= 0 || available <= 0) return 1;
  return clamp(available / width, min, max);
}

const overlaps = (a: Box, b: Box) => a.y < b.y + b.h && b.y < a.y + a.h;

/** Problems that would draw a broken map. Empty means the map is consistent. */
export function validateMaps(maps: readonly ArchMap[]): string[] {
  const problems: string[] = [];
  const mapIds = new Set<string>();
  for (const m of maps) {
    if (mapIds.has(m.id)) problems.push(`duplicate map id ${m.id}`);
    mapIds.add(m.id);
  }
  for (const m of maps) {
    const laneIds = new Set(m.lanes.map((l) => l.id));
    const ids = new Set<string>();
    for (const n of m.nodes) {
      if (ids.has(n.id)) problems.push(`${m.id}: duplicate node ${n.id}`);
      ids.add(n.id);
      if (!laneIds.has(n.lane)) problems.push(`${m.id}: ${n.id} is in unknown lane ${n.lane}`);
      if (n.detail !== undefined && (!mapIds.has(n.detail) || n.detail === m.id))
        problems.push(`${m.id}: ${n.id} opens unknown or own map ${n.detail}`);
    }
    m.edges.forEach((e, i) => {
      if (!ids.has(e.from) || !ids.has(e.to))
        problems.push(`${m.id}: edge ${i} ${e.from}→${e.to} names a missing node`);
      if (e.from === e.to) problems.push(`${m.id}: edge ${i} loops on ${e.from}`);
      if (e.flows.length === 0) problems.push(`${m.id}: edge ${i} has no flow`);
    });
    for (const r of m.regions ?? [])
      if (!laneIds.has(r.from) || !laneIds.has(r.to))
        problems.push(`${m.id}: region ${r.label} spans an unknown lane`);
    const placed = Object.values(layoutMap(m).nodes);
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i];
        const b = placed[j];
        if (a.lane === b.lane && overlaps(a, b)) problems.push(`${m.id}: ${a.id} overlaps ${b.id}`);
      }
  }
  return problems;
}
