/* Two React members in one worker (ADR 0015, M2d task 2). */
import { roots } from './two-members-dom';
import { createRoot } from 'react-dom/client';
import { Counter } from './counter';

roots.forEach((root, i) => {
  createRoot(root).render(<Counter label={i === 0 ? 'A' : 'B'} />);
});
