// A contracts module that claims a kernel topic: contracts() throws reserved_topic on import.
import { contracts, topic, unchecked, type Contracts } from '../contracts/topic';

const list: Contracts = contracts(
  topic('isoloop.route.v1', { schema: unchecked(), retention: { kind: 'compacted' } }),
);
export default list;
