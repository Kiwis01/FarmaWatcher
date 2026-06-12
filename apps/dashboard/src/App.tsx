import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchEvents,
  toDate,
  hms,
  parse,
  KIND,
  type EventsResult,
  type EventPayload,
  type EventRow,
} from "./lib";

const KIND_KEYS = ["recall_detected", "patient_matched", "bulletin_generated", "alert_sent"];

function ClassTag({ c }: { c?: string }) {
  if (!c) return null;
  return <span className={`cls cls-${c}`}>Clase {c}</span>;
}

function Summary({ kind, d }: { kind: string; d: EventPayload }) {
  switch (kind) {
    case "recall_detected":
      return (
        <>
          <strong>{d.drug}</strong>
          {d.sourceUrl ? (
            <a href={d.sourceUrl} target="_blank" rel="noreferrer" className="lnk">
              {d.recallId}
              <span className="ext" aria-hidden="true">
                ↗
              </span>
            </a>
          ) : (
            <span className="data">{d.recallId}</span>
          )}
          <ClassTag c={d.classification} />
        </>
      );
    case "patient_matched":
      return (
        <>
          <strong>{d.name || d.patientId}</strong>
          {d.patientId && <span className="data">{d.patientId}</span>}
          {d.drugs && d.drugs.length > 0 && <span>{d.drugs.join(", ")}</span>}
        </>
      );
    case "bulletin_generated":
      return (
        <>
          <span>Paciente</span>
          <span className="data">{d.patientId}</span>
          <span className="faint">{d.chars ?? 0} caracteres</span>
        </>
      );
    case "alert_sent":
      return (
        <>
          <span className="data">{d.patientId}</span>
          <span>{d.channel}</span>
          {d.ok ? <span className="ok">✓ enviada</span> : <span className="fail">✗ falló</span>}
          <span className="data">{d.ref}</span>
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

  // Revelado escalonado solo en la primera carga; las filas nuevas entran sin retraso.
  const firstBatch = useRef(true);
  const delays = useRef(new Map<string, number>());

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetchEvents();
        if (!alive) return;
        setData(res);
        setOffline(false);
        setUpdated(hms(new Date()));
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

  useEffect(() => {
    if (data) firstBatch.current = false;
  }, [data]);

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
    { label: "Eventos", value: events.length },
    { label: "Recalls únicos", value: recallsById.size },
    { label: "Pacientes afectados", value: patients.length },
    { label: "Alertas enviadas", value: events.filter((e) => e.kind === "alert_sent").length },
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
      <header className="top">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <div>
            <h1>FarmacoVigía</h1>
            <p>Centro de eventos · Farmacovigilancia</p>
          </div>
        </div>
        <div className="status">
          <SourceBadge source={source} />
          <span className="live">
            <span className="dot" aria-hidden="true" />
            En vivo
          </span>
          <span className="clock">Actualizado {updated}</span>
        </div>
      </header>

      <section className="band" aria-label="Cifras">
        {stats.map((s) => (
          <div key={s.label} className="cell">
            <div className="num">{s.value}</div>
            <div className="cap">{s.label}</div>
          </div>
        ))}
      </section>

      {patientFilter && (
        <div className="filterbar">
          <span>
            Filtrando paciente <strong>{patientFilter}</strong>
          </span>
          <button className="clear" onClick={() => setPatientFilter(null)}>
            ✕ Quitar filtro
          </button>
        </div>
      )}

      <div className="grid">
        <section className="col-feed">
          <div className="sec-head">
            <h2>Flujo de eventos</h2>
            <div className="chips" role="group" aria-label="Filtrar por tipo">
              {KIND_KEYS.map((k) => (
                <button
                  key={k}
                  className={`chip ${activeKinds.has(k) ? "on" : ""}`}
                  aria-pressed={activeKinds.has(k)}
                  onClick={() => toggleKind(k)}
                >
                  {KIND[k]?.code}
                </button>
              ))}
            </div>
          </div>
          {feed.length === 0 ? (
            <p className="empty">
              Sin eventos con este filtro. Activa más tipos arriba o quita el filtro de
              paciente.
            </p>
          ) : (
            <ol className="feed">
              {feed.map((e: EventRow, i: number) => {
                const meta = KIND[e.kind] ?? { label: e.kind, code: e.kind, cls: "" };
                const d = parse(e.payload);
                const key = `${e.ts}|${e.kind}|${e.payload}`;
                let delay = delays.current.get(key);
                if (delay === undefined) {
                  delay = firstBatch.current ? Math.min(i, 14) * 40 : 0;
                  delays.current.set(key, delay);
                }
                return (
                  <li
                    key={key}
                    className={`ev ${meta.cls}`}
                    style={delay ? { animationDelay: `${delay}ms` } : undefined}
                  >
                    <time className="t">{hms(toDate(e.ts))}</time>
                    <span className="code" title={meta.label}>
                      {meta.code}
                    </span>
                    <div className="body">
                      <Summary kind={e.kind} d={d} />
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <aside className="rail">
          <section>
            <h2>Recalls por clase</h2>
            <ClassChart counts={classCounts} />
          </section>

          <section>
            <h2>Pacientes afectados</h2>
            {patients.length === 0 ? (
              <p className="empty">Ninguno todavía — el agente está vigilando.</p>
            ) : (
              <ul className="patients">
                {patients.map((p) => (
                  <li key={p.id}>
                    <button
                      className={`pt ${patientFilter === p.id ? "sel" : ""}`}
                      aria-pressed={patientFilter === p.id}
                      onClick={() =>
                        setPatientFilter(patientFilter === p.id ? null : p.id)
                      }
                    >
                      <span
                        className={`rn rn-${p.worst}`}
                        title={`Peor clase: ${p.worst}`}
                      >
                        {p.worst}
                      </span>
                      <span className="pt-name">{p.name}</span>
                      <span className="pt-drugs">{p.drugs.join(", ")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2>Boletines · Claude</h2>
            {bulletins.length === 0 ? (
              <p className="empty">
                Aún no hay boletines. Se generan cuando un recall coincide con un
                paciente.
              </p>
            ) : (
              <div className="bulletins">
                {bulletins.map((d, i) => (
                  <article key={`${d.patientId}-${i}`} className="bull">
                    <div className="who">Paciente {d.patientId}</div>
                    <p className="txt">{d.bulletin}</p>
                  </article>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>

      <footer className="creds">
        <span>
          Datos <b>ClickHouse</b>
        </span>
        <span>
          Deploy <b>Render</b>
        </span>
        <span>
          LLM <b>TrueFoundry</b>
        </span>
        <span>
          Alertas <b>Composio</b>
        </span>
        <span>
          Fuente <b>openFDA</b>
        </span>
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
          <div key={r.c} className="crow" title={r.label}>
            <span className={`rn rn-${r.c}`}>{r.c}</span>
            <div className="track">
              {v > 0 && (
                <div className={`fill f-${r.c}`} style={{ width: `${(v / max) * 100}%` }} />
              )}
            </div>
            <span className="cval">{v}</span>
          </div>
        );
      })}
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  if (source === "clickhouse") return <span className="tag ok">ClickHouse</span>;
  if (source === "local") return <span className="tag ok">Fuente · Worker</span>;
  if (source === "offline") return <span className="tag warn">Sin conexión</span>;
  return <span className="tag warn">Respaldo</span>;
}
