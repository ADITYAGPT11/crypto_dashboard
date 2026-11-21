import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  flowHighlight,
  flowsIn,
  neighbourhood,
  progress,
  type ArchMap,
  type ArchNode,
  type FlowId,
  type NodeKind,
} from "../../utils/archMap";
import ArchDiagram from "./ArchDiagram";
import { FLOWS, MAPS, MAPS_BY_ID, OVERVIEW } from "./maps";
import styles from "./TechOverviewPage.module.scss";

const TECH_OVERVIEW_PATH = "/tech-overview";
const mapPath = (id: string) =>
  id === OVERVIEW.id ? TECH_OVERVIEW_PATH : `${TECH_OVERVIEW_PATH}/${id}`;

const KIND_LABEL: Record<NodeKind, string> = {
  india: "Exchange · allowed in India",
  ref: "Exchange · global reference",
  ext: "External service",
  infra: "Infrastructure",
  fmt: "Generic format",
  svc: "Browser code",
  py: "Python service",
  page: "Screen",
  bus: "Router",
};

const flowDot = (f: FlowId) => (
  <i className={`${styles.dot} ${styles[`d_${f}`] ?? ""}`} aria-hidden="true" />
);

/** `/tech-overview` and `/tech-overview/:mapId`: the clickable architecture maps. */
const TechOverviewPage: React.FC = () => {
  const { mapId } = useParams();
  const map = mapId ? MAPS_BY_ID[mapId] : OVERVIEW;
  if (!map) {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.h1}>No map called “{mapId}”</h1>
          <p>
            It may have been renamed. <Link to={TECH_OVERVIEW_PATH}>Open the tech overview</Link>.
          </p>
        </div>
      </main>
    );
  }
  return <MapView key={map.id} map={map} />;
};

const MapView: React.FC<{ map: ArchMap }> = ({ map }) => {
  const [params, setParams] = useSearchParams();
  const flows = useMemo(() => flowsIn(map), [map]);
  const flowParam = params.get("flow");
  const flow = flows.find((f) => f === flowParam) ?? null;
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const isOverview = map.id === OVERVIEW.id;

  const focusId = hovered ?? selected;
  const highlight = useMemo(
    () => (focusId ? neighbourhood(map, focusId) : flow ? flowHighlight(map, flow) : null),
    [map, focusId, flow],
  );

  const setFlow = useCallback(
    (f: FlowId | null) => {
      setSelected(null);
      setParams(f ? { flow: f } : {}, { replace: true });
    },
    [setParams],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelected(null);
        setHovered(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hrefFor = useCallback((n: ArchNode) => (n.detail ? mapPath(n.detail) : undefined), []);
  const select = useCallback((id: string) => {
    setHovered(null);
    setSelected((cur) => (cur === id ? null : id));
  }, []);

  const { built, planned } = progress(map);
  const focusNode = focusId ? map.nodes.find((n) => n.id === focusId) : undefined;

  return (
    <main className={styles.page}>
      {!isOverview && (
        <nav className={styles.crumbs} aria-label="Breadcrumb">
          <Link to={TECH_OVERVIEW_PATH}>Tech overview</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{map.title}</span>
        </nav>
      )}
      <header className={styles.pagehead}>
        <div>
          <h1>{map.title}</h1>
          <p className={styles.summary}>{map.summary}</p>
        </div>
        <div className={styles.legend} aria-label="Legend">
          <span>
            <i className={`${styles.sw} ${styles.swIndia}`} aria-hidden="true" />
            Allowed in India
          </span>
          <span>
            <i className={`${styles.sw} ${styles.swRef}`} aria-hidden="true" />
            Reference market (data only)
          </span>
          <span>
            <i className={`${styles.sw} ${styles.swPlan}`} aria-hidden="true" />
            Planned
          </span>
          <span>
            <b className={styles.chevKey} aria-hidden="true">
              ›
            </b>
            Opens a detailed map
          </span>
          <span className={styles.count}>
            {built} built · {planned} planned
          </span>
        </div>
      </header>

      <div className={styles.flows} role="group" aria-label="Trace a data flow">
        <span className={styles.lbl}>Trace a flow</span>
        <button
          type="button"
          className={styles.chip}
          aria-pressed={flow === null}
          onClick={() => setFlow(null)}
        >
          Everything
        </button>
        {flows.map((f) => (
          <button
            key={f}
            type="button"
            className={styles.chip}
            aria-pressed={flow === f}
            onClick={() => setFlow(flow === f ? null : f)}
          >
            {flowDot(f)}
            {FLOWS[f].name}
          </button>
        ))}
      </div>

      <div className={styles.main}>
        <ArchDiagram
          map={map}
          highlight={highlight}
          selectedId={selected}
          onHover={setHovered}
          onSelect={select}
          hrefFor={hrefFor}
        />
        <aside className={styles.panel}>
          {focusNode ? (
            <NodePanel
              map={map}
              node={focusNode}
              onSelect={select}
              onClose={() => setSelected(null)}
            />
          ) : flow ? (
            <FlowPanel flow={flow} mapId={map.id} />
          ) : (
            <MapPanel map={map} />
          )}
        </aside>
      </div>
    </main>
  );
};

const NodePanel: React.FC<{
  map: ArchMap;
  node: ArchNode;
  onSelect: (id: string) => void;
  onClose: () => void;
}> = ({ map, node, onSelect, onClose }) => {
  const byId = (id: string) => map.nodes.find((n) => n.id === id);
  const incoming = map.edges.filter((e) => e.to === node.id);
  const outgoing = map.edges.filter((e) => e.from === node.id);
  const detail = node.detail ? MAPS_BY_ID[node.detail] : undefined;
  const status = node.planned ? "Planned" : node.kind === "ref" ? "Data only" : "Built";
  const statusCls = node.planned
    ? styles.pillPlanned
    : node.kind === "ref"
      ? styles.pillRef
      : styles.pillBuilt;
  const linkList = (edges: typeof incoming, end: "from" | "to") => (
    <div className={styles.links}>
      {edges.map((e, i) => {
        const other = byId(e[end]);
        if (!other) return null;
        return (
          <button
            key={`${other.id}-${i}`}
            type="button"
            className={styles.linkBtn}
            onClick={() => onSelect(other.id)}
          >
            {flowDot(e.flows[0])}
            {other.title}
            {e.label && <span className={styles.mute}> · {e.label}</span>}
          </button>
        );
      })}
    </div>
  );
  return (
    <>
      <div className={styles.eyebrow}>
        {KIND_LABEL[node.kind]} <span className={`${styles.pill} ${statusCls}`}>{status}</span>
      </div>
      <h2>{node.title}</h2>
      <p>{node.desc}</p>
      {detail && (
        <Link className={styles.open} to={mapPath(detail.id)}>
          Open detailed map: {detail.title} →
        </Link>
      )}
      {node.files && node.files.length > 0 && (
        <>
          <h3>Where it lives</h3>
          <ul className={styles.files}>
            {node.files.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </>
      )}
      {node.endpoints && node.endpoints.length > 0 && (
        <>
          <h3>Talks to</h3>
          <ul className={styles.files}>
            {node.endpoints.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </>
      )}
      {incoming.length > 0 && (
        <>
          <h3>Receives from</h3>
          {linkList(incoming, "from")}
        </>
      )}
      {outgoing.length > 0 && (
        <>
          <h3>Sends to</h3>
          {linkList(outgoing, "to")}
        </>
      )}
      <button type="button" className={styles.back} onClick={onClose}>
        Back to the map summary
      </button>
    </>
  );
};

const FlowPanel: React.FC<{ flow: FlowId; mapId: string }> = ({ flow, mapId }) => {
  const info = FLOWS[flow];
  const detail = info.detail && info.detail !== mapId ? MAPS_BY_ID[info.detail] : undefined;
  return (
    <>
      <div className={styles.eyebrow}>Data flow</div>
      <h2>
        {flowDot(flow)} {info.name}
      </h2>
      <p>{info.intro}</p>
      <h3>Step by step</h3>
      <ol className={styles.steps}>
        {info.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      {detail && (
        <Link className={styles.open} to={mapPath(detail.id)}>
          Open detailed map: {detail.title} →
        </Link>
      )}
    </>
  );
};

const MapPanel: React.FC<{ map: ArchMap }> = ({ map }) => {
  const isOverview = map.id === OVERVIEW.id;
  const others = MAPS.filter((m) => m.id !== OVERVIEW.id && m.id !== map.id);
  return (
    <>
      {isOverview ? (
        <>
          <div className={styles.eyebrow}>Overview</div>
          <h2>Three processes, one rule set</h2>
          <p>The system confirms; a human trades. Nothing here places orders.</p>
          <dl className={styles.procs}>
            <dt>:3000</dt>
            <dd>
              <b>React app.</b> Streams live data straight from exchanges, draws the chart and
              heatmap, sizes positions.
            </dd>
            <dt>:8000</dt>
            <dd>
              <b>Python analysis service.</b> Owns every pattern, zone and order-block rule and
              measures each setup over 1–2 years.
            </dd>
            <dt>:3001</dt>
            <dd>
              <b>Node prototype.</b> Holds the Telegram token and relays alerts. Being replaced by
              Python.
            </dd>
          </dl>
        </>
      ) : (
        <>
          <div className={styles.eyebrow}>How to read this map</div>
          <p>
            Hover a box to trace its connections; click it for files and links. Boxes with › open
            another detailed map.
          </p>
        </>
      )}
      <h3>{isOverview ? "Detailed maps" : "Other maps"}</h3>
      <ul className={styles.mapList}>
        {others.map((m) => {
          const p = progress(m);
          const pct = Math.round((p.built / Math.max(1, p.built + p.planned)) * 100);
          return (
            <li key={m.id}>
              <Link to={mapPath(m.id)}>
                <span className={styles.mapTitle}>{m.title}</span>
                <span className={styles.mapMeta}>
                  {p.built} built · {p.planned} planned
                </span>
                <span className={styles.bar} aria-hidden="true">
                  <i style={{ width: `${pct}%` }} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className={styles.note}>
        Out of date? Edit <code>src/components/TechOverviewPage/maps.ts</code>. The tests fail when
        a listed file no longer exists.
      </p>
    </>
  );
};

export default TechOverviewPage;
