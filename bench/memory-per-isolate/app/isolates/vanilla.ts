// An idle vanilla isolate: a small static tree, then nothing.
import { defineIsolate, type IsolateDefinition } from '@isoloop/runtime';

const def: IsolateDefinition<HTMLElement> = defineIsolate<HTMLElement>({
  start(ctx) {
    const p = document.createElement('p');
    p.textContent = `idle ${ctx.id}`;
    ctx.root?.append(p);
  },
});
export default def;
