import { loadEnv } from "./env";
import type { Alert } from "@farmavigia/shared";
import { checkDrugSafety } from "@farmavigia/sources";
import { loadPatients } from "./patients";
import { recordEvent } from "./eventlog";
import { postAlert } from "./notify";

// El agente clínico de FarmacoVigía:
//   padrón sintético -> checkDrugSafety (openFDA + boletín Claude/TrueFoundry)
//   -> postAlert (Composio, mock hasta M2) -> eventos en ClickHouse + espejo local.
async function runOnce(): Promise<number> {
  const patients = loadPatients();
  console.log(`🩺 Revisando ${patients.length} paciente(s) del padrón sintético...`);

  let alertCount = 0;

  for (const patient of patients) {
    const report = await checkDrugSafety({
      patientId: patient.id,
      drugs: patient.drugs,
    });

    const flagged = report.drugs.filter((d) => d.activeRecalls.length > 0);
    if (flagged.length === 0) {
      console.log(`   ✓ ${patient.name} (${patient.id}): sin retiros activos.`);
      continue;
    }

    for (const drug of flagged) {
      for (const recall of drug.activeRecalls) {
        await recordEvent("recall_detected", {
          patientId: patient.id,
          drug: drug.input,
          recallId: recall.recallId,
          classification: recall.classification,
          status: recall.status,
          sourceUrl: recall.sourceUrl,
        });
      }
    }

    await recordEvent("patient_matched", {
      patientId: patient.id,
      name: patient.name,
      drugs: flagged.map((d) => d.input),
    });

    await recordEvent("bulletin_generated", {
      patientId: patient.id,
      chars: report.bulletin.length,
      bulletin: report.bulletin,
    });

    const alert: Alert = {
      title: `⚠️ Retiro de medicamento afecta a ${patient.name}`,
      body: `${report.bulletin}\n\n${report.disclaimer}`,
      channel: "slack",
      provenance: report.sources.map((url) => ({ url })),
    };

    const res = await postAlert(alert);

    await recordEvent("alert_sent", {
      patientId: patient.id,
      channel: alert.channel,
      ok: res.ok,
      ref: res.ref,
    });

    alertCount++;
    console.log(
      `\n✅ Alerta procesada — ${patient.name} (${patient.id}): ${flagged
        .map((d) => d.input)
        .join(", ")}`,
    );
  }

  console.log(
    `\n🏁 ${alertCount} alerta(s) generada(s) de ${patients.length} paciente(s).`,
  );
  return alertCount;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  loadEnv();

  const intervalSec = Number(process.env.WORKER_INTERVAL_SEC ?? 0);

  if (intervalSec > 0) {
    console.log(
      `🔁 Modo continuo activado — revisión cada ${intervalSec}s. (Ctrl+C para detener)`,
    );
    for (;;) {
      const stamp = new Date().toLocaleTimeString("es-MX");
      console.log(`\n──────────── pasada ${stamp} ────────────`);
      try {
        await runOnce();
      } catch (e) {
        console.error("La pasada falló (se reintenta):", (e as Error).message);
      }
      await sleep(intervalSec * 1000);
    }
  } else {
    await runOnce();
  }
}

main().catch((err) => {
  console.error("Worker falló:", err);
  process.exit(1);
});
