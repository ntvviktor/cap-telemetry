import { initCAPTracing } from './srv/cap-tracing.js';
import cds from '@sap/cds';

const tracing = initCAPTracing({
  samplingIntervalMs: 50 // Adjust based on needs
});

// Enable stack sampling for deep visibility
tracing.startStackSampling();

// ALSO instrument CAP handlers for clean span names
cds.on('served', (services) => {
  Object.values(services).forEach(service => {
    tracing.instrumentService(service);
  });
});
