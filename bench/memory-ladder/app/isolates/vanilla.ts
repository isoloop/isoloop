// A vanilla isolate: headless it does nothing; with a surface, one paragraph.
import { defineIsolate, type IsolateDefinition } from '@isoloop/runtime';

const def: IsolateDefinition<HTMLElement> = defineIsolate<HTMLElement>({
  start(ctx) {
    if (!ctx.root) return;
    const p = document.createElement('p');
    p.textContent = `idle ${ctx.id}`;
    ctx.root.append(p);
  },
});
export default def;
