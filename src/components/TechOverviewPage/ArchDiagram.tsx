import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  edgePath,
  fitScale,
  layoutMap,
  type ArchMap,
  type ArchNode,
  type FlowId,
  type Highlight,
} from "../../utils/archMap";
import styles from "./TechOverviewPage.module.scss";

const FLOW_IDS: FlowId[] = ["live", "depth", "analysis", "alerts", "planned"];

interface Props {
  map: ArchMap;
  /** What to light up; everything else dims. Null shows the whole map. */
  highlight: Highlight | null;
  selectedId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  /** Route a node opens, if it has a detailed map. */
  hrefFor: (node: ArchNode) => string | undefined;
}

/** One architecture map: lanes, regions, edges (SVG) and clickable boxes, scaled to fit. */
const ArchDiagram: React.FC<Props> = ({
  map,
  highlight,
  selectedId,
  onHover,
  onSelect,
  hrefFor,
}) => {
  const layout = useMemo(() => layoutMap(map), [map]);
  const markerId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const scroller = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const fit = () => setScale(fitScale(el.clientWidth - 2, layout.width));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout.width]);

  const cls = (...names: (string | false | undefined)[]) =>
    names
      .filter((n): n is string => Boolean(n))
      .map((n) => styles[n] ?? "")
      .join(" ");

  return (
    <div className={styles.scroller} ref={scroller}>
      <div
        className={styles.stage}
        style={{ width: layout.width * scale, height: layout.height * scale }}
      >
        <div
          className={cls("canvas", highlight !== null && "dim")}
          style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}
        >
          <svg
            className={styles.edges}
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            aria-hidden="true"
          >
            <defs>
              {FLOW_IDS.map((f) => (
                <marker
                  key={f}
                  id={`${markerId}-${f}`}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M0,1 L9,5 L0,9 z" className={cls(`m_${f}`)} />
                </marker>
              ))}
            </defs>
            {layout.regions.map((r) => (
              <g key={r.label}>
                <rect className={styles.region} x={r.x} y={r.y} width={r.w} height={r.h} rx="10" />
                <text className={styles.regionLabel} x={r.x + 12} y={r.y + 18}>
                  {r.label}
                </text>
              </g>
            ))}
            {map.lanes.map((l) => {
              const lane = layout.lanes[l.id];
              const narrow = lane.w < 90;
              return (
                <text
                  key={l.id}
                  className={styles.laneLabel}
                  x={narrow ? lane.x + lane.w / 2 : lane.x}
                  y={20}
                  textAnchor={narrow ? "middle" : "start"}
                >
                  {l.label}
                </text>
              );
            })}
            {map.edges.map((e, i) => {
              const s = layout.nodes[e.from];
              const t = layout.nodes[e.to];
              if (!s || !t) return null;
              const on = highlight?.edges.has(i) ?? false;
              const planned = e.flows.includes("planned");
              return (
                <path
                  key={`${e.from}-${e.to}-${i}`}
                  d={edgePath(s, t)}
                  className={cls(
                    "edge",
                    `f_${e.flows[0]}`,
                    planned && "edgePlanned",
                    on && "on",
                    on && !planned && "flowing",
                  )}
                  markerEnd={`url(#${markerId}-${e.flows[0]})`}
                />
              );
            })}
          </svg>

          {map.nodes.map((n) => {
            const box = layout.nodes[n.id];
            if (!box) return null;
            const href = hrefFor(n);
            const className = cls(
              "node",
              `k_${n.kind}`,
              n.planned && "planned",
              highlight?.nodes.has(n.id) && "on",
              selectedId === n.id && "sel",
              href !== undefined && "drill",
            );
            const style = { left: box.x, top: box.y, width: box.w, height: box.h };
            const label = `${n.title}: ${n.sub}${n.planned ? " (planned)" : ""}${href ? ". Opens a detailed map" : ""}`;
            const content = (
              <>
                <span className={styles.nodeTitle}>{n.title}</span>
                <span className={styles.nodeSub}>{n.sub}</span>
                {href && (
                  <span className={styles.chev} aria-hidden="true">
                    ›
                  </span>
                )}
              </>
            );
            const events = {
              onMouseEnter: () => onHover(n.id),
              onMouseLeave: () => onHover(null),
              onFocus: () => onHover(n.id),
              onBlur: () => onHover(null),
            };
            return href ? (
              <Link
                key={n.id}
                to={href}
                className={className}
                style={style}
                aria-label={label}
                {...events}
              >
                {content}
              </Link>
            ) : (
              <button
                key={n.id}
                type="button"
                className={className}
                style={style}
                aria-label={label}
                aria-pressed={selectedId === n.id}
                onClick={() => onSelect(n.id)}
                {...events}
              >
                {content}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ArchDiagram;
