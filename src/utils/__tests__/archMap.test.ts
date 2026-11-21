import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  edgePath,
  fitScale,
  flowHighlight,
  flowsIn,
  layoutMap,
  LANE_GAP,
  neighbourhood,
  NODE_H,
  progress,
  validateMaps,
  type ArchMap,
  type PlacedNode,
} from "../archMap";
import { FLOWS, MAPS, MAPS_BY_ID, OVERVIEW } from "../../components/TechOverviewPage/maps";

const node = (id: string, lane: string, y: number, extra: Partial<ArchMap["nodes"][0]> = {}) => ({
  id,
  lane,
  y,
  title: id,
  sub: "",
  kind: "svc" as const,
  desc: "",
  ...extra,
});

const tiny: ArchMap = {
  id: "tiny",
  title: "Tiny",
  summary: "",
  lanes: [
    { id: "a", label: "A", w: 100 },
    { id: "b", label: "B", w: 120 },
  ],
  regions: [{ label: "R", from: "a", to: "b", y: 30, h: 200 }],
  nodes: [node("x", "a", 70), node("y", "b", 70), node("z", "b", 150, { planned: true })],
  edges: [
    { from: "x", to: "y", flows: ["live"] },
    { from: "y", to: "z", flows: ["alerts"] },
  ],
};

const placed = (p: Partial<PlacedNode>): PlacedNode => ({
  id: "n",
  lane: "a",
  bus: false,
  x: 0,
  y: 0,
  w: 100,
  h: NODE_H,
  ...p,
});

describe("layoutMap", () => {
  it("places lanes left to right with a fixed gap and sizes the canvas", () => {
    const l = layoutMap(tiny);
    expect(l.lanes.a.x).toBe(14);
    expect(l.lanes.b.x).toBe(14 + 100 + LANE_GAP);
    expect(l.width).toBe(l.lanes.b.x + 120 + 14);
    expect(l.nodes.z).toMatchObject({ x: l.lanes.b.x, y: 150, w: 120, h: NODE_H });
    expect(l.height).toBe(Math.max(150 + NODE_H, 30 + 200) + 24);
  });

  it("pads regions around the lanes they span", () => {
    const [r] = layoutMap(tiny).regions;
    expect(r.x).toBe(2);
    expect(r.w).toBe(14 + 100 + LANE_GAP + 120 + 12 - 2);
  });
});

describe("edgePath", () => {
  it("goes from the right side to the left side when moving right", () => {
    const d = edgePath(placed({ x: 0, y: 0 }), placed({ id: "t", lane: "b", x: 200, y: 100 }));
    expect(d).toBe("M100,23 C150,23 150,123 200,123");
  });

  it("runs vertically within a lane", () => {
    const d = edgePath(placed({ y: 0 }), placed({ id: "t", y: 100 }));
    expect(d).toBe("M50,46 C50,73 50,73 50,100");
  });

  it("meets a bus at the other end's height, clamped inside the bus", () => {
    const bus = placed({ id: "bus", lane: "bus", bus: true, x: 0, y: 0, w: 60, h: 300 });
    expect(edgePath(bus, placed({ id: "t", lane: "b", x: 200, y: 100 }))).toMatch(/^M60,123 /);
    expect(edgePath(bus, placed({ id: "t", lane: "b", x: 200, y: 600 }))).toMatch(/^M60,288 /);
  });

  it("leaves from the left side when the target lane is to the left", () => {
    const d = edgePath(placed({ lane: "b", x: 300, y: 0 }), placed({ id: "t", x: 0, y: 0 }));
    expect(d.startsWith("M300,23")).toBe(true);
    expect(d.endsWith("100,23")).toBe(true);
  });
});

describe("highlights", () => {
  it("collects a node's neighbours and edges", () => {
    const h = neighbourhood(tiny, "y");
    expect([...h.nodes].sort()).toEqual(["x", "y", "z"]);
    expect([...h.edges]).toEqual([0, 1]);
  });

  it("collects a flow's edges and endpoints", () => {
    const h = flowHighlight(tiny, "alerts");
    expect([...h.nodes].sort()).toEqual(["y", "z"]);
    expect([...h.edges]).toEqual([1]);
  });

  it("lists the flows a map uses in a fixed order", () => {
    expect(flowsIn(tiny)).toEqual(["live", "alerts"]);
  });

  it("counts built and planned boxes", () => {
    expect(progress(tiny)).toEqual({ built: 2, planned: 1 });
  });
});

describe("fitScale", () => {
  it("fits the width between the bounds", () => {
    expect(fitScale(600, 1200)).toBe(0.6);
    expect(fitScale(300, 1200)).toBe(0.6);
    expect(fitScale(1000, 1000)).toBe(1);
    expect(fitScale(3000, 1000)).toBe(1.1);
    expect(fitScale(0, 1000)).toBe(1);
  });
});

describe("validateMaps", () => {
  it("accepts a consistent map", () => {
    expect(validateMaps([tiny])).toEqual([]);
  });

  it("reports missing nodes, unknown lanes, bad detail links and overlaps", () => {
    const broken: ArchMap = {
      ...tiny,
      nodes: [
        node("x", "a", 70, { detail: "nowhere" }),
        node("y", "b", 70),
        node("w", "b", 90),
        node("q", "c", 0),
      ],
      edges: [{ from: "x", to: "gone", flows: ["live"] }],
    };
    const problems = validateMaps([broken]);
    expect(problems).toContain("tiny: x opens unknown or own map nowhere");
    expect(problems).toContain("tiny: q is in unknown lane c");
    expect(problems).toContain("tiny: edge 0 x→gone names a missing node");
    expect(problems).toContain("tiny: y overlaps w");
  });
});

describe("the project's architecture maps", () => {
  it("are consistent", () => {
    expect(validateMaps(MAPS)).toEqual([]);
  });

  it("start with the overview and give every detail map a way in", () => {
    expect(MAPS[0]).toBe(OVERVIEW);
    const linked = new Set(MAPS.flatMap((m) => m.nodes.map((n) => n.detail)));
    for (const f of Object.values(FLOWS)) linked.add(f.detail);
    for (const m of MAPS.slice(1)) expect(linked.has(m.id), m.id).toBe(true);
  });

  it("link every flow to an existing map", () => {
    for (const f of Object.values(FLOWS)) if (f.detail) expect(MAPS_BY_ID[f.detail]).toBeDefined();
  });

  it("name only files that exist in the repo", () => {
    const missing = MAPS.flatMap((m) =>
      m.nodes.flatMap((n) =>
        (n.files ?? [])
          .filter((f) => !existsSync(resolve(process.cwd(), f)))
          .map((f) => `${m.id}/${n.id}: ${f}`),
      ),
    );
    expect(missing).toEqual([]);
  });
});
