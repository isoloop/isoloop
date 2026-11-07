// The smallest app that uses @isoloop/vite: it only reads the worker URLs.
import workers from 'virtual:isoloop/workers';

console.log(workers.isolateBootstrap, workers.bus);
