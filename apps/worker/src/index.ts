import { loadEnv } from "./env";
import type { Alert } from "@farmavigia/shared";
import { checkDrugSafety } from "@farmavigia/sources";
import { loadPatients } from "./patients";
import { recordEvent } from "./eventlog";
import { postAlert } from "./notify";
import { alertKey, markAlerted, wasAlerted } from "./sent";

// El agente clínico de FarmacoVigía:
//   padrón sintético -> checkDrugSafety (openFDA + boletín Claude/TrueFoundry)
//   -> postAlert (Composio, mock hasta M2) -> eventos en ClickHouse + espejo local.
async function runOnce(): Promise<number> {
  const patients = loadPatients();
  console.log(`🩺 Checking ${patients.length} patient(s) from the synthetic registry...`);

  let alertCount = 0;

  for (const patient of patients) {
    const report = await checkDrugSafety({
      patientId: patient.id,
      drugs: patient.drugs,
    });

    const flagged = report.drugs.filter((d) => d.activeRecalls.length > 0);
    if (flagged.length === 0) {
      console.log(`   ✓ ${patient.name} (${patient.id}): no active recalls.`);
      continue;
    }

    // Solo retiros que no se hayan alertado antes: en modo continuo cada
    // pasada vuelve a ver los mismos recalls activos y no debe repetirlos.
    const newKeys: string[] = [];
    for (const drug of flagged) {
      for (const recall of drug.activeRecalls) {
        const key = alertKey(patient.id, recall.recallId);
        if (wasAlerted(key)) continue;
        newKeys.push(key);
        await recordEvent("recall_detected", {
          patientId: patient.id,
          drug: drug.input,
          recallId: recall.recallId,
          classification: recall.classification,
          reason: recall.reason,
          status: recall.status,
          sourceUrl: recall.sourceUrl,
        });
      }
    }

    if (newKeys.length === 0) {
      console.log(
        `   ✓ ${patient.name} (${patient.id}): recalls already alerted, nothing new.`,
      );
      continue;
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
      title: `⚠️ Drug recall affects ${patient.name}`,
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

    // Marcar como enviadas solo si llegaron de verdad (no dry-run ni error),
    // para que un fallo de Composio se reintente en la siguiente pasada.
    if (res.ok && !res.ref.startsWith("dry-run")) {
      markAlerted(newKeys);
    }

    alertCount++;
    console.log(
      `\n✅ Alert processed — ${patient.name} (${patient.id}): ${flagged
        .map((d) => d.input)
        .join(", ")}`,
    );
  }

  console.log(
    `\n🏁 ${alertCount} alert(s) generated for ${patients.length} patient(s).`,
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
      `🔁 Continuous mode on — checking every ${intervalSec}s. (Ctrl+C to stop)`,
    );
    for (;;) {
      const stamp = new Date().toLocaleTimeString("en-US", { hour12: false });
      console.log(`\n──────────── run ${stamp} ────────────`);
      try {
        await runOnce();
      } catch (e) {
        console.error("Run failed (will retry):", (e as Error).message);
      }
      await sleep(intervalSec * 1000);
    }
  } else {
    await runOnce();
  }
}

main().catch((err) => {
  console.error("Worker failed:", err);
  process.exit(1);
});
