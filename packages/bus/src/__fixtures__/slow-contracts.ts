// The same contracts, taking a while to load (a large schema library, say).
import list from './contracts';

await new Promise((resolve) => setTimeout(resolve, 300));

export default list;
