import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCustomerMapping } from './customerMapping';

const dir = resolve('outputs/customer-mapping-20261012');
const rows = JSON.parse(readFileSync(resolve(dir, 'source.json'), 'utf8'));
const stations = JSON.parse(readFileSync(resolve(dir, 'stations-readonly.json'), 'utf8'));
const plan = buildCustomerMapping(rows, stations);
writeFileSync(resolve(dir, 'mapping-plan.json'), JSON.stringify(plan, null, 2));
console.log(JSON.stringify({ ...plan, mapping: undefined }, null, 2));
