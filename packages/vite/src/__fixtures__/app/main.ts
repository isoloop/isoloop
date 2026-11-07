// The smallest app that uses @isoloop/vite: it reads the worker and isolate URLs.
import isolates from 'virtual:isoloop/isolates';
import workers from 'virtual:isoloop/workers';

console.log(workers.isolateBootstrap, workers.bus, isolates);
