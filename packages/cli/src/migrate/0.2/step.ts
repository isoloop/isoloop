/*
 * The `0.2` step. It rewrites nothing: it gives the codemod gate and the
 * fixture runner a step to check.
 */
import type { Step } from '../step';

export const step: Step = {
  version: '0.2',
  summary: 'no source changes',
  mayChange: () => false,
  transform: () => ({ edits: [], flags: [] }),
};
