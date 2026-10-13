import fs from 'node:fs/promises';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const dir = new URL('../', import.meta.url);
const plan = JSON.parse(await fs.readFile(new URL('mapping-plan.json', dir), 'utf8'));
const wb = Workbook.create();
const summary = wb.worksheets.add('Summary');
const detail = wb.worksheets.add('Mapping');
const statuses = { update: 'พร้อมบันทึก', unchanged: 'ตรงกับข้อมูลเดิม', 'not-in-source': 'ไม่พบชื่อที่จับคู่ได้', 'source-customer-blank': 'Owner ในไฟล์ว่าง', conflict: 'ข้อมูลขัดแย้ง' };
const last = plan.mapping.length + 4;
for (const sheet of [summary, detail]) {
  sheet.showGridLines = false;
  sheet.getRange(sheet === summary ? 'A1:E53' : `A1:G${last}`).format.font = { name: 'Arial', size: 10, color: '#25354A' };
  sheet.getRange(sheet === summary ? 'A1:E53' : `A1:G${last}`).format.rowHeight = 22;
  sheet.getRange(sheet === summary ? 'A1:E53' : `A1:G${last}`).format.verticalAlignment = 'center';
}
function header(sheet, range) {
  sheet.getRange(range).format = { fill: '#243B53', font: { name: 'Arial', size: 10, bold: true, color: '#FFFFFF' }, horizontalAlignment: 'center', verticalAlignment: 'center', rowHeight: 26 };
}
detail.getRange('A2').values = [['ผลจับคู่รายสถานี']];
detail.getRange('A2').format.font = { size: 15, bold: true };
detail.getRange('A3').values = [['แหล่งข้อมูล: Powermodule (1).xlsx / katin คอลัมน์ B (Station) และ C (Owner) + ฐานข้อมูล Station ณ 12 ต.ค. 2026']];
detail.getRange('A4:G4').values = [['Station ID', 'ชื่อในระบบ', 'ชื่อแสดงผล', 'Customer ปัจจุบัน', 'Customer จากไฟล์', 'ผลจับคู่', 'แถว Excel']];
detail.getRange(`A5:G${last}`).values = plan.mapping.map(row => [row.id, row.name, row.displayName, row.before || null, row.customer || null, statuses[row.status], row.sourceRows.join(', ') || null]);
detail.getRange(`E5:E${last}`).conditionalFormats.add('containsBlanks', { format: { fill: '#FFF1DA', font: { color: '#985600' } } });
detail.tables.add(`A4:G${last}`, true, 'CustomerMapping');
header(detail, 'A4:G4');
detail.freezePanes.freezeRows(4);
for (const [column, width] of [['A', 22], ['B', 36], ['C', 36], ['D', 24], ['E', 24], ['F', 28], ['G', 18]]) detail.getRange(`${column}1:${column}${last}`).format.columnWidth = width;
summary.getRange('A2').values = [['สรุปการจับคู่ Customer']];
summary.getRange('A2').format.font = { size: 15, bold: true };
summary.getRange('A3').values = [['ผลพร้อมตรวจสอบ ยังไม่ได้บันทึกลงฐานข้อมูล']];
summary.getRange('A3').format.font = { italic: true, color: '#985600' };
summary.getRange('A5:B9').values = [['รายการ', 'สถานี'], ['สถานีในระบบ', null], ['จับคู่ Customer ได้', null], ['ยังระบุ Customer ไม่ได้', null], ['มี Customer อยู่ก่อนแล้ว', null]];
summary.getRange('B6:B9').formulas = [
  [`=COUNTA('Mapping'!A5:A${last})`],
  [`=COUNTA('Mapping'!A5:A${last})-COUNTBLANK('Mapping'!E5:E${last})`],
  [`=COUNTBLANK('Mapping'!E5:E${last})`],
  [`=COUNTA('Mapping'!A5:A${last})-COUNTBLANK('Mapping'!D5:D${last})`],
];
header(summary, 'A5:B5');
summary.getRange('D5:E9').values = [['Customer จากไฟล์', 'สถานี'], ['PT', null], ['EGAT', null], ['K.บาส', null], ['นิชาทัน', null]];
summary.getRange('E6:E9').formulas = [6, 7, 8, 9].map(row => [`=COUNTIFS('Mapping'!E5:E${last},D${row})`]);
header(summary, 'D5:E5');
summary.getRange('A11').values = [['สถานีที่ยังระบุ Customer ไม่ได้จากไฟล์ (27 สถานี)']];
summary.getRange('A11').format.font = { bold: true };
summary.getRange('A12:E12').values = [['Station ID', 'ชื่อในระบบ', 'ชื่อแสดงผล', 'เหตุผล', 'แถว Excel']];
const missingEnd = 12 + plan.missingCustomer.length;
summary.getRange(`A13:E${missingEnd}`).values = plan.missingCustomer.map(row => [row.id, row.name, row.displayName, statuses[row.status], row.sourceRows.join(', ') || null]);
header(summary, 'A12:E12');
summary.getRange('A42').values = [['ไฟล์มี Owner แต่ยังไม่พบชื่อสถานีที่จับคู่ได้ในระบบ']];
summary.getRange('A42').format.font = { bold: true };
summary.getRange('A43:C43').values = [['แถว Excel', 'Station ในไฟล์', 'Owner']];
const unmatchedOwners = plan.unmatchedSource.filter(row => row.customer);
summary.getRange(`A44:C${43 + unmatchedOwners.length}`).values = unmatchedOwners.map(row => [row.row, row.station, row.customer]);
header(summary, 'A43:C43');
summary.getRange('A50').values = [['จับคู่จากชื่อปัจจุบันก่อน ID เดิม ตัดหมายเหตุท้ายชื่อในวงเล็บเมื่อชื่อที่เหลือตรงกัน']];
summary.getRange('A51').values = [['VRK2 ในไฟล์อาจเกี่ยวข้องกับ VRK ในระบบ แต่ยังไม่ยืนยันจึงเว้นไว้']];
summary.getRange('A52').values = [['PHRAE1 จับคู่กับชื่อแสดงผล PHRAE1; PHRAE5 ที่ยังใช้ ID เดิม PHRAE1 จะไม่ถูกเติมโดยเดา']];
for (const [column, width] of [['A', 23], ['B', 38], ['C', 38], ['D', 31], ['E', 18]]) summary.getRange(`${column}1:${column}53`).format.columnWidth = width;
summary.getRange('B6:B9').setNumberFormat('#,##0');
summary.getRange('E6:E9').setNumberFormat('#,##0');
summary.tabColor = '#243B53';
wb.recalculate();
const check = await wb.inspect({ kind: 'table', range: 'Summary!A5:E9', include: 'values,formulas', tableMaxRows: 5, tableMaxCols: 5, maxChars: 2200 });
console.log(check.ndjson);
const errors = await wb.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!', options: { useRegex: true, maxResults: 20 }, maxChars: 1200 });
console.log(errors.ndjson);
for (const [sheetName, range, file] of [['Summary', 'A1:E39', 'summary-preview.png'], ['Summary', 'A42:E52', 'notes-preview.png'], ['Mapping', 'A1:G15', 'mapping-preview.png']]) {
  const preview = await wb.render({ sheetName, range, scale: 1.4, format: 'png' });
  await fs.writeFile(new URL(file, dir), new Uint8Array(await preview.arrayBuffer()));
}
const output = await SpreadsheetFile.exportXlsx(wb);
await output.save(new URL('Customer-Mapping-Review.xlsx', dir).pathname.replace(/^\/(\w:)/, '$1'));
console.log(JSON.stringify({ mapped: plan.databaseStations - plan.missingCustomer.length, missing: plan.missingCustomer.length, output: 'Customer-Mapping-Review.xlsx' }));
