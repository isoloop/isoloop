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

/**
 * One change inside a release's step. A step that makes several changes is a
 * list of these, one file each beside its `step.ts`, joined by
 * {@link combine}.
 */
export type Transform = Pick<Step, 'summary' | 'mayChange' | 'transform'>;

/**
 * A release's step made of `transforms`: a file is parsed when any of them may
 * change it, and their edits and flags are put together. Two transforms must
 * never edit the same range.
 */
export function combine(version: string, transforms: readonly Transform[]): Step {
  return {
    version,
    summary: transforms.map((t) => t.summary).join('; '),
    mayChange: (text) => transforms.some((t) => t.mayChange(text)),
    transform: (file) => {
      const changes = transforms
        .filter((t) => t.mayChange(file.text))
        .map((t) => t.transform(file));
      return {
        edits: changes.flatMap((c) => c.edits),
        flags: changes.flatMap((c) => c.flags),
      };
    },
  };
}
