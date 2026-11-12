import { defineIsolate, useIsolate } from '@isoloop/react';
import { Table } from '../table';

function Widget() {
  return <Table id={useIsolate().id} />;
}
export default defineIsolate(Widget);
