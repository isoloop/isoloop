// An isoloop-dom isolate for the EventBridge E2E tests (plan m1-kernel, task 8).
// The input is "controlled", as a framework would do it: every input event
// writes the isolate's own value back, upper-cased, so the host sees a value
// that differs from what's being typed. "block" busies the worker for 1 s.

export default {
  /** @param {{ root: Element }} ctx */
  start(ctx) {
    const form = document.createElement('form');
    const input = document.createElement('input');
    input.setAttribute('class', 'field');
    const echo = document.createElement('p');
    echo.setAttribute('class', 'echo');
    const status = document.createElement('p');
    status.setAttribute('class', 'status');
    const submit = document.createElement('button');
    submit.setAttribute('type', 'submit');
    submit.textContent = 'send';
    const block = document.createElement('button');
    block.setAttribute('type', 'button');
    block.setAttribute('class', 'block');
    block.textContent = 'block';

    input.addEventListener('input', () => {
      const value = input.value;
      Object.assign(input, { value: value.toUpperCase() });
      echo.textContent = value;
    });
    form.addEventListener('submit', () => {
      status.textContent = 'submitted';
    });
    block.addEventListener('click', () => {
      const t = performance.now();
      while (performance.now() - t < 1000) {
        // Busy on purpose.
      }
    });

    form.append(input, submit);
    ctx.root.append(form, block, echo, status);
  },
};
