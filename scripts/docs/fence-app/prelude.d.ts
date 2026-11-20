// The app around the guides' fences (M4c, docs:check item 2). A fence may use
// these without declaring them, as the code a guide builds on: the kernel that
// getting started creates, and the two parts of its config. Everything else a
// fence uses, it imports. Keep this list short: each name here is one a reader
// has to know from elsewhere.

/** The app's kernel, as `createKernel` returned it. */
declare const kernel: import('@isoloop/host').Kernel;
/** `KernelConfig.contracts`: the contracts module's URL and its default export. */
declare const contracts: { url: string; list: import('@isoloop/bus').Contracts };
/** `KernelConfig.workers`, from `virtual:isoloop/workers`. */
declare const workers: import('@isoloop/host').KernelConfig['workers'];
