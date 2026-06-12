import { useEffect, useMemo, useState } from "react";
import {
  fetchEvents,
  toDate,
  rel,
  parse,
  KIND,
  type EventsResult,
  type EventPayload,
  type EventRow,
} from "./lib";

const KIND_KEYS = ["recall_detected", "patient_matched", "bulletin_generated", "alert_sent"];

function ClassPill({ c }: { c?: string }) {
  if (!c) return null;
  return <span className={`pill cls-${c}`}>Clase {c}</span>;
}

function Summary({ kind, d }: { kind: string; d: EventPayload }) {
  switch (kind) {
    case "recall_detected":
      return (
        <>
          {d.drug} ·{" "}
          {d.sourceUrl ? (
            <a href={d.sourceUrl} target="_blank" rel="noreferrer" className="lnk">
              recall {d.recallId} ↗
            </a>
          ) : (
            <>recall {d.recallId}</>
          )}{" "}
          <ClassPill c={d.classification} />
        </>
      );
    case "patient_matched":
      return (
        <>
          {d.name || d.patientId}
          {d.patientId ? ` (${d.patientId})` : ""}
          {d.drugs ? ` · ${(d.drugs ?? []).join(", ")}` : ""}
        </>
      );
    case "bulletin_generated":
      return (
        <>
          Paciente {d.patientId} · {d.chars ?? 0} caracteres
        </>
      );
    case "alert_sent":
      return (
        <>
          Paciente {d.patientId} · {d.channel} ·{" "}
          {d.ok ? "✅ enviada" : "⚠️ falló"} ({d.ref})
        </>
      );
    default:
      return null;
  }
}

export default function App() {
  const [data, setData] = useState<EventsResult | null>(null);
  const [updated, setUpdated] = useState("—");
  const [offline, setOffline] = useState(false);
  const [activeKinds, setActiveKinds] = useState<Set<string>>(new Set(KIND_KEYS));
  const [patientFilter, setPatientFilter] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetchEvents();
        if (!alive) return;
        setData(res);
        setOffline(false);
        setUpdated(new Date().toLocaleTimeString("es-MX"));
      } catch {
        if (alive) setOffline(true);
      }
    };
    load();
    const id = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const events = useMemo(
    () =>
      (data?.events ?? [])
        .slice()
        .sort((a, b) => toDate(b.ts).getTime() - toDate(a.ts).getTime()),
    [data],
  );

  // Entidades únicas (para que las cifras no se inflen en modo continuo).
  const recallsById = useMemo(() => {
    const m = new Map<string, string>(); // recallId -> classification
    for (const e of events) {
      if (e.kind !== "recall_detected") continue;
      const d = parse(e.payload);
      if (d.recallId) m.set(d.recallId, d.classification ?? "II");
    }
    return m;
  }, [events]);

  const patients = useMemo(() => {
    const m = new Map<string, { name: string; drugs: string[]; worst: string }>();
    for (const e of events) {
      const d = parse(e.payload);
      if (e.kind === "patient_matched" && d.patientId) {
        m.set(d.patientId, {
          name: d.name ?? d.patientId,
          drugs: d.drugs ?? [],
          worst: m.get(d.patientId)?.worst ?? "III",
        });
      }
      if (e.kind === "recall_detected" && d.patientId) {
        const cur = m.get(d.patientId);
        const cls = d.classification ?? "III";
        const worse = rank(cls) < rank(cur?.worst ?? "III") ? cls : cur?.worst ?? "III";
        m.set(d.patientId, {
          name: cur?.name ?? d.patientId,
          drugs: cur?.drugs ?? [],
          worst: worse,
        });
      }
    }
    return [...m.entries()].map(([id, v]) => ({ id, ...v })).sort(
      (a, b) => rank(a.worst) - rank(b.worst),
    );
  }, [events]);

  const classCounts = useMemo(() => {
    const c: Record<string, number> = { I: 0, II: 0, III: 0 };
    for (const cls of recallsById.values()) c[cls] = (c[cls] ?? 0) + 1;
    return c;
  }, [recallsById]);

  const feed = events.filter((e) => {
    if (!activeKinds.has(e.kind)) return false;
    if (patientFilter) return parse(e.payload).patientId === patientFilter;
    return true;
  });

  const bulletins = events
    .filter((e) => e.kind === "bulletin_generated")
    .filter((e) => !patientFilter || parse(e.payload).patientId === patientFilter)
    .map((e) => parse(e.payload))
    .filter((d) => d.bulletin);

  const source = offline ? "offline" : (data?.source ?? "backup");

  const stats = [
    { label: "Eventos totales", value: events.length, cls: "" },
    { label: "Recalls únicos", value: recallsById.size, cls: "s-recall" },
    { label: "Pacientes afectados", value: patients.length, cls: "s-patient" },
    { label: "Alertas enviadas", value: events.filter((e) => e.kind === "alert_sent").length, cls: "s-alert" },
  ];

  const toggleKind = (k: string) => {
    setActiveKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next.size === 0 ? new Set(KIND_KEYS) : next;
    });
  };

  return (
    <div className="wrap">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">℞</div>
          <div>
            <h1>FarmacoVigía</h1>
            <p>Centro de eventos de farmacovigilancia</p>
          </div>
        </div>
        <div className="status">
          <SourceBadge source={source} />
          <span className="live">
            <span className="dot" /> En vivo
          </span>
          <span className="muted">Actualizado {updated}</span>
        </div>
      </header>

      <section className="stats">
        {stats.map((s) => (
          <div key={s.label} className={`stat ${s.cls}`}>
            <div className="label">{s.label}</div>
            <div className="value">{s.value}</div>
          </div>
        ))}
      </section>

      {patientFilter && (
        <div className="filterbar">
          Filtrando por paciente <b>{patientFilter}</b>
          <button className="clear" onClick={() => setPatientFilter(null)}>
            ✕ quitar filtro
          </button>
        </div>
      )}

      <div className="grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Flujo de eventos</h2>
            <div className="chips">
              {KIND_KEYS.map((k) => (
                <button
                  key={k}
                  className={`chip ${KIND[k]?.cls ?? ""} ${activeKinds.has(k) ? "on" : ""}`}
                  onClick={() => toggleKind(k)}
                >
                  {KIND[k]?.icon} {KIND[k]?.label}
                </button>
              ))}
            </div>
          </div>
          {feed.length === 0 ? (
            <p className="empty">Sin eventos para este filtro.</p>
          ) : (
            <ol className="feed">
              {feed.map((e: EventRow, i: number) => {
                const meta = KIND[e.kind] ?? { label: e.kind, icon: "•", cls: "" };
                const d = parse(e.payload);
                return (
                  <li key={`${e.ts}-${i}`} className={`ev ${meta.cls}`}>
                    <div className="ic">{meta.icon}</div>
                    <div className="body">
                      <div className="title">{meta.label}</div>
                      <div className="sub">
                        <Summary kind={e.kind} d={d} />
                      </div>
                    </div>
                    <div className="time">{rel(toDate(e.ts))}</div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <div className="side">
          <section className="panel">
            <h2>Recalls por clase</h2>
            <ClassChart counts={classCounts} />
          </section>

          <section className="panel">
            <h2>Pacientes afectados</h2>
            {patients.length === 0 ? (
              <p className="empty">Ninguno todavía.</p>
            ) : (
              <ul className="patients">
                {patients.map((p) => (
                  <li
                    key={p.id}
                    className={`pt ${patientFilter === p.id ? "sel" : ""}`}
                    onClick={() => setPatientFilter(patientFilter === p.id ? null : p.id)}
                  >
                    <span className={`sev sev-${p.worst}`} title={`Peor clase: ${p.worst}`} />
                    <span className="pt-name">{p.name}</span>
                    <span className="pt-drugs">{p.drugs.join(", ")}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <h2>Boletines (Claude)</h2>
            {bulletins.length === 0 ? (
              <p className="empty">Aún no hay boletines.</p>
            ) : (
              <div className="bulletins">
                {bulletins.map((d, i) => (
                  <div key={`${d.patientId}-${i}`} className="bull">
                    <div className="who">Paciente {d.patientId}</div>
                    <div className="txt">{d.bulletin}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <footer className="sponsors">
        <span>Datos en <b>ClickHouse</b></span>
        <span>Deploy en <b>Render</b></span>
        <span>LLM vía <b>TrueFoundry</b></span>
        <span>Alertas vía <b>Composio</b></span>
        <span>Fuente <b>openFDA</b></span>
      </footer>
    </div>
  );
}

function rank(c: string): number {
  return c === "I" ? 0 : c === "II" ? 1 : 2;
}

function ClassChart({ counts }: { counts: Record<string, number> }) {
  const max = Math.max(1, counts.I ?? 0, counts.II ?? 0, counts.III ?? 0);
  const rows: { c: string; label: string }[] = [
    { c: "I", label: "Clase I" },
    { c: "II", label: "Clase II" },
    { c: "III", label: "Clase III" },
  ];
  return (
    <div className="chart">
      {rows.map((r) => {
        const v = counts[r.c] ?? 0;
        return (
          <div key={r.c} className="chart-row">
            <span className="chart-label">{r.label}</span>
            <div className="chart-track">
              <div className={`chart-bar bar-${r.c}`} style={{ width: `${(v / max) * 100}%` }} />
            </div>
            <span className="chart-val">{v}</span>
          </div>
        );
      })}
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  if (source === "clickhouse") return <span className="badge ok">● ClickHouse</span>;
  if (source === "local") return <span className="badge ok">● Worker (en vivo)</span>;
  if (source === "offline") return <span className="badge warn">● Sin conexión</span>;
  return <span className="badge warn">● Respaldo</span>;
}
