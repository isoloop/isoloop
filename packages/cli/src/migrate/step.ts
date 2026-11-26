import type { Change } from './edit';
import type { SourceFile } from './parser';

/**
 * One release's codemod. It lives in `migrate/<version>/step.ts`, with
 * before/after fixtures in `migrate/<version>/fixtures/`. It must leave its
 * own output alone, so running it twice changes nothing.
 */
export type Step = {
  /** The release it migrates code to, as `major.minor`. */
  readonly version: string;
  /** One line for the command's output. */
  readonly summary: string;
  /** A cheap test on the text: files it returns `false` for aren't parsed. */
  readonly mayChange: (text: string) => boolean;
  /** The edits and flags for one file. */
  readonly transform: (file: SourceFile) => Change;
};
