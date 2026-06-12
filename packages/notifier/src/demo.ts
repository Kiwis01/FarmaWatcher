// Prueba manual: publica una alerta de ejemplo.
//   npm run notifier:demo            (usa DRY_RUN/.env)
// Carga .env de la raíz si existe.
import 'dotenv/config';
import { postAlert } from './index.js';
import type { Alert } from '@farmacovigia/shared';

const alert: Alert = {
  title: '⚠️ Retiro FDA Clase I — Losartán 50mg',
  body:
    'Un paciente de tu padrón toma Losartán, sujeto a retiro Clase I por contaminación con nitrosaminas. ' +
    'Suspender y contactar al prescriptor.',
  channel: (process.argv[2] as 'slack' | 'gmail') || 'slack',
  provenance: [
    { url: 'https://api.fda.gov/drug/enforcement.json?search=losartan' },
  ],
};

postAlert(alert)
  .then((r) => {
    console.log('Resultado:', r);
    process.exit(r.ok ? 0 : 1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
