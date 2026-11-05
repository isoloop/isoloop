/*
 * The page around the isolates, from the proof of concept: a pane per
 * isolate (name, status, restarts, restart button, crash overlay), the
 * main-thread fps chip, the block-main button and the bus log.
 */
import type { IsolateSnapshot, Kernel } from '@isoloop/host';

export type Pane = {
  id: string;
  body: HTMLElement;
  paint(s: IsolateSnapshot | undefined): void;
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text = '',
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
}

export function createPane(root: HTMLElement, id: string, name: string, kernel: Kernel): Pane {
  const pane = el('section', 'pane');
  pane.dataset['isolate'] = id;
  const head = el('div', 'pane-head');
  const restarts = el('span', 'restarts');
  const status = el('span', 'status', 'starting');
  const restart = el('button', 'small', 'Restart');
  restart.addEventListener('click', () => {
    void kernel.restart(id);
  });
  head.append(el('strong', '', name), restarts, status, restart);
  const body = el('div', 'pane-body');
  const overlay = el('div', 'crash-overlay');
  pane.append(head, body, overlay);
  root.append(pane);

  return {
    id,
    body,
    paint(s) {
      if (!s) return;
      restarts.textContent = s.restarts ? `restarts: ${s.restarts}` : '';
      // Between a crash and the respawn, the supervisor is `restarting` with the error kept.
      const crashed = s.state === 'crashed' || (s.state === 'restarting' && s.error !== undefined);
      pane.classList.toggle('is-crashed', crashed);
      if (crashed) {
        status.className = 'status crashed';
        status.textContent = 'crashed';
        overlay.textContent = `${s.error ?? 'Unknown error'} — restarting (backoff)…`;
        return;
      }
      if (s.state === 'blocked') {
        const since = performance.now() - s.lastBeatAt;
        status.className = 'status blocked';
        status.textContent = `blocked ${(since / 1000).toFixed(1)}s`;
      } else if (s.state === 'running') {
        status.className = 'status';
        status.textContent = `loop ok · lag ${Math.round(s.lagMs)}ms`;
      } else if (s.state === 'failed') {
        status.className = 'status crashed';
        status.textContent = 'failed';
      } else {
        status.className = 'status';
        status.textContent = 'starting';
      }
    },
  };
}

export function busLogText(
  topic: string,
  r: { offset: number; producer: string; value: unknown },
): string {
  return `bus: ${r.producer} → ${topic}#${r.offset} ${JSON.stringify(r.value)}`;
}

export function startFps(chip: HTMLElement): void {
  let frames = 0;
  let mark = performance.now();
  const loop = (now: number): void => {
    frames++;
    if (now - mark >= 500) {
      chip.textContent = `main: ${Math.round((frames * 1000) / (now - mark))} fps`;
      frames = 0;
      mark = now;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

export function blockMain(ms: number): void {
  const t = performance.now();
  while (performance.now() - t < ms) {
    // Blocks the main thread on purpose: every pane freezes on screen.
  }
}
