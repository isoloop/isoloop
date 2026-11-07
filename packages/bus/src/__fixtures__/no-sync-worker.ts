/// <reference lib="webworker" />
// The bus worker in a browser without OPFS sync access handles (M2b task 15).
import { serve } from '../server';

declare const self: DedicatedWorkerGlobalScope;

Reflect.deleteProperty(FileSystemFileHandle.prototype, 'createSyncAccessHandle');
serve(self);
