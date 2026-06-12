import type { PostAlert } from "@farmavigia/shared";

// MOCK de postAlert (contrato B -> A).
//
// En M2, Persona B entrega `packages/notifier` con la implementación real (Composio).
// Para integrar, basta con:
//   1) agregar "@farmavigia/notifier": "*" a apps/worker/package.json
//   2) reemplazar este archivo por:  export { postAlert } from "@farmavigia/notifier";
//
// La firma es exactamente PostAlert, así que el resto del worker no cambia.
export const postAlert: PostAlert = async (alert) => {
  const dryRun =
    process.env.DRY_RUN !== "0" && process.env.DRY_RUN !== "false";

  if (dryRun) {
    console.log(`\n📣 [DRY_RUN] Alerta (mock, no enviada) — canal: ${alert.channel}`);
    console.log(`   Título: ${alert.title}`);
    console.log(
      "   Cuerpo:\n" +
        alert.body
          .split("\n")
          .map((l) => "     " + l)
          .join("\n"),
    );
    if (alert.provenance.length) {
      console.log(
        "   Fuentes: " + alert.provenance.map((p) => p.url).join(", "),
      );
    }
    return { ok: true, ref: "dry-run" };
  }

  console.warn(
    "postAlert mock: DRY_RUN desactivado pero aún no hay notifier real (lo provee Persona B en M2).",
  );
  return { ok: false, ref: "no-notifier" };
};
