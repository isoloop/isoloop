// Test isolate on isoloop-dom@1: `start(ctx)` with plain DOM calls on ctx.root.
// Typed structurally; the worker's `document` is the isoloop-dom subset.
type Ctx = { root?: Element };

export default {
  start(ctx: Ctx): void {
    const root = ctx.root;
    if (!root) throw new Error('no root');
    let n = 0;
    const count = document.createElement('span');
    count.setAttribute('class', 'n');
    count.textContent = '0';
    const button = document.createElement('button');
    button.textContent = 'inc';
    button.addEventListener('click', () => {
      n++;
      count.textContent = String(n);
    });
    const input = document.createElement('input');
    const echo = document.createElement('p');
    echo.setAttribute('class', 'echo');
    input.addEventListener('input', () => {
      echo.textContent = input.value;
    });
    root.append(count, button, input, echo);
  },
};
