// Test isolate (M3a task 11): built with defineIsolate, so it carries `requires`.
import { defineIsolate, type IsolateDefinition } from '../vanilla';

const def: IsolateDefinition = defineIsolate({
  start() {},
});
export default def;
