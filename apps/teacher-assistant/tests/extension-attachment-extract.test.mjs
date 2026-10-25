import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { deflateRawSync } from "node:zlib";

function createExtractContext() {
  const context = {
    TextDecoder,
    TextEncoder,
    DecompressionStream,
    Blob,
    Response,
    atob,
    btoa,
    URL,
    setTimeout,
    clearTimeout,
    createImageBitmap: async blob => { const bytes = new Uint8Array(await blob.arrayBuffer()); if (bytes.length < 40) throw new Error("incomplete image"); return {width:1,height:1,close(){}}; },
  };
  context.LearningTongBatch = { digest: s => String(s.length) };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(new URL("../extension/attachment-extract.js", import.meta.url), "utf8"), context);
  return context.LearningTongAttachmentExtract;
}

function buildZip(entries) {
  const encoder = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = entry.data;
    const method = entry.deflate ? 8 : 0;
    const crc = createExtractContext().crc32(data);
    const stored = entry.deflate ? deflateRawSync(data) : data;
    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(8, method, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, stored.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    parts.push(local, stored);
    const centralEntry = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralEntry.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, stored.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    centralEntry.set(nameBytes, 46);
    central.push(centralEntry);
    offset += local.length + stored.length;
  }
  const cdSize = central.reduce((sum, c) => sum + c.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, cdSize, true);
  eocdView.setUint32(16, offset, true);
  const all = [...parts, ...central, eocd];
  const zip = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let pos = 0;
  for (const part of all) {
    zip.set(part, pos);
    pos += part.length;
  }
  return zip;
}

const SAMPLE_XML = '<w:document><w:body><w:p>第一段&amp;内容</w:p><w:p>def&lt;ghi</w:p></w:body></w:document>';

test("docxXmlToText converts document.xml into readable text", () => {
  const api = createExtractContext();
  assert.equal(api.docxXmlToText(SAMPLE_XML), "第一段&内容\ndef<ghi\n");
});

test("decodeXmlEntities resolves numeric and named entities", () => {
  const api = createExtractContext();
  assert.equal(api.decodeXmlEntities("A&#x4e2d;B&#25968;C&amp;D&quot;E"), "A中B数C&D\"E");
});

test("extractDocxText reads a stored docx zip", async () => {
  const api = createExtractContext();
  const zip = buildZip([{ name: "word/document.xml", data: new TextEncoder().encode(SAMPLE_XML) }]);
  const text = await api.extractDocxText(zip.buffer);
  assert.equal(text, "第一段&内容\ndef<ghi\n");
});

test("extractDocxText reads a deflated docx zip", async () => {
  const api = createExtractContext();
  const zip = buildZip([
    { name: "[Content_Types].xml", data: new TextEncoder().encode("<Types/>") },
    { name: "word/document.xml", data: new TextEncoder().encode(SAMPLE_XML), deflate: true },
  ]);
  const text = await api.extractDocxText(zip.buffer);
  assert.equal(text, "第一段&内容\ndef<ghi\n");
});

test("extractDocxText reports missing document body", async () => {
  const api = createExtractContext();
  const zip = buildZip([{ name: "other.txt", data: new TextEncoder().encode("x") }]);
  await assert.rejects(() => api.extractDocxText(zip.buffer), /未找到正文内容/);
});

test("extract decodes base64 text attachments end to end", async () => {
  const api = createExtractContext();
  const download = async () => ({ ok: true, dataBase64: Buffer.from("学生提交的文本答案", "utf8").toString("base64") });
  const result = await api.extract({ kind: "text", fileName: "answer.txt", href: "https://example.com/a.txt" }, download);
  assert.equal(result.ok, true);
  assert.equal(result.text, "学生提交的文本答案");
  assert.equal(result.truncated, false);
});

test("extract reads docx attachments through the injected downloader", async () => {
  const api = createExtractContext();
  const zip = buildZip([{ name: "word/document.xml", data: new TextEncoder().encode(SAMPLE_XML) }]);
  const download = async () => ({ ok: true, dataBase64: Buffer.from(zip).toString("base64") });
  const result = await api.extract({ kind: "word", fileName: "报告.docx", href: "https://example.com/a.docx" }, download);
  assert.equal(result.ok, true);
  assert.equal(result.text, "第一段&内容\ndef<ghi");
});

test("extract rejects legacy .doc files with a manual-grading hint", async () => {
  const api = createExtractContext();
  const download = async () => ({ ok: true, dataBase64: Buffer.from("x").toString("base64") });
  const result = await api.extract({ kind: "word", fileName: "报告.doc", href: "https://example.com/a.doc" }, download);
  assert.equal(result.ok, false);
  assert.match(result.reason, /\.doc 暂不支持/);
});

test("extract surfaces download failures", async () => {
  const api = createExtractContext();
  const download = async () => ({ ok: false, reason: "附件下载失败（HTTP 404），请人工批改。" });
  const result = await api.extract({ kind: "text", fileName: "a.txt", href: "https://example.com/a.txt" }, download);
  assert.equal(result.ok, false);
  assert.match(result.reason, /HTTP 404/);
});

test("extract flags empty attachments as non-extractable", async () => {
  const api = createExtractContext();
  const download = async () => ({ ok: true, dataBase64: Buffer.from("   \u0000 ").toString("base64") });
  const result = await api.extract({ kind: "text", fileName: "a.txt", href: "https://example.com/a.txt" }, download);
  assert.equal(result.ok, false);
  assert.match(result.reason, /未提取到文本内容/);
});

test("extract degrades gracefully when the pdf runtime is unavailable", async () => {
  const api = createExtractContext();
  const download = async () => ({ ok: true, dataBase64: Buffer.from("%PDF-1.4").toString("base64") });
  const result = await api.extract({ kind: "pdf", fileName: "a.pdf", href: "https://example.com/a.pdf" }, download);
  assert.equal(result.ok, false);
  assert.match(result.reason, /附件解析失败/);
});

test("extract rejects requests without a download transport", async () => {
  const api = createExtractContext();
  const result = await api.extract({ kind: "text", fileName: "a.txt", href: "https://example.com/a.txt" });
  assert.equal(result.ok, false);
  assert.match(result.reason, /下载通道不可用/);
});

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0L8AAAAASUVORK5CYII=", "base64");
const DRAWING = '<w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>';
const documentWithImage = body => '<w:document><w:body><w:p>图片前文字'+body+'</w:p><w:p>图片后文字</w:p></w:body></w:document>';
function imageDocx(xml=documentWithImage(DRAWING), target='media/image1.png', content=PNG, extra=[]) { return buildZip([
 {name:'word/document.xml',data:new TextEncoder().encode(xml),deflate:true},
 {name:'word/_rels/document.xml.rels',data:new TextEncoder().encode('<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="'+target+'"/></Relationships>')},
 {name:'word/media/image1.png',data:content},...extra
]); }
test('DOCX inline raster image preserves ordered text and original bytes',async()=>{
 const api=createExtractContext(),zip=imageDocx(),r=await api.extractDocxMaterial(zip,true);
 assert.equal(r.ok,true);assert.equal(r.images[0],`data:image/png;base64,${PNG.toString('base64')}`);assert.match(r.text,/图片前文字.*内嵌图片1/);assert.match(r.text,/图片后文字/);
});
test('DOCX image without vision capability blocks; no silent text-only grading',async()=>{
 await assert.rejects(()=>createExtractContext().extractDocxMaterial(imageDocx(),false),/图像能力/);
});
test('DOCX floating, cropped, chart, alternate content, headers and tracked deletion require manual review',async()=>{
 for(const body of [DRAWING.replace('wp:inline','wp:anchor'),DRAWING.replace('<a:blip','<a:srcRect/><a:blip'),'<c:chart/>','<mc:AlternateContent/>','<w:headerReference/>','<w:del><w:t>删除内容</w:t></w:del>']) await assert.rejects(()=>createExtractContext().extractDocxMaterial(imageDocx(documentWithImage(body)),true),/未支持|浮动|裁剪/);
});
test('DOCX missing, external, traversal and unsupported image sources block',async()=>{
 for(const target of ['media/missing.png','https://example.org/p.png','media/../image1.png']) await assert.rejects(()=>createExtractContext().extractDocxMaterial(imageDocx(undefined,target),true),/关系未核验|缺失/);
 await assert.rejects(()=>createExtractContext().extractDocxMaterial(imageDocx(undefined,undefined,new TextEncoder().encode('<svg/>')),true),/不是支持/);
});
test('DOCX damaged bytes and duplicate entry names are not accepted',async()=>{
 const zip=imageDocx();zip[zip.indexOf(PNG[0],200)]^=1;
 await assert.rejects(()=>createExtractContext().extractDocxMaterial(zip,true),/校验失败|结构/);
 await assert.rejects(()=>createExtractContext().extractDocxMaterial(imageDocx(undefined,undefined,undefined,[{name:'word/document.xml',data:new TextEncoder().encode(SAMPLE_XML)}]),true),/重复/);
});
test('DOCX full material API and invalid base64 produce explicit outcomes',async()=>{
 const api=createExtractContext(),r=await api.extractMaterial({kind:'word',fileName:'模拟.docx'},async()=>({ok:true,dataBase64:Buffer.from(imageDocx()).toString('base64')}),{vision:true});assert.equal(r.ok,true);assert.equal(r.images.length,1);assert.ok(r.contentKey);
 const invalid=await api.extractMaterial({kind:'word',fileName:'模拟.docx'},async()=>({ok:true,dataBase64:'!@#$'}));assert.equal(invalid.ok,false);assert.match(invalid.reason,/解码失败/);
});

test('truncated raster bytes with a correct signature cannot be scored',async()=>{
 const api=createExtractContext();await assert.rejects(()=>api.validateRaster(Uint8Array.from([137,80,78,71,13,10,26,10]),'image/png'),/完整解码/);
});


test("malformed UTF-8 text is unreadable instead of a replacement-character answer",async()=>{
 const r=await createExtractContext().extractMaterial({kind:'text',fileName:'answer.txt'},async()=>({ok:true,dataBase64:Buffer.from([0xe4,0xb8]).toString('base64')}));assert.equal(r.ok,false);assert.match(r.reason,/附件解析失败/);
});
test("unsupported binary attachment cannot be treated as UTF-8 text",async()=>{
 let called=false;const r=await createExtractContext().extractMaterial({kind:'other',fileName:'answer.zip'},async()=>{called=true;return {ok:true,dataBase64:Buffer.from('binary masquerading as an answer').toString('base64')};});assert.equal(r.ok,false);assert.equal(called,false);
});

const archiveDownload = bytes => async()=>({ok:true,dataBase64:Buffer.from(bytes).toString('base64')});
test('ZIP reads every supported file and nested document without executing code',async()=>{
 const api=createExtractContext(),enc=new TextEncoder();
 const docx=buildZip([{name:'word/document.xml',data:enc.encode(SAMPLE_XML)}]);
 const zip=buildZip([{name:'资料/说明.md',data:enc.encode('完整岗位条件')},{name:'资料/答卷.docx',data:docx},{name:'app.js',data:enc.encode('throw new Error("must never run");')}]);
 const r=await api.extractMaterial({kind:'archive',fileName:'answer.zip'},archiveDownload(zip));
 assert.equal(r.ok,true,r.reason);assert.equal(r.files.length,3);assert.equal(r.archiveComplete,true);assert.match(r.text,/完整岗位条件/);assert.match(r.text,/第一段&内容/);assert.match(r.text,/must never run/);assert.match(r.execution,/未执行/);
});
test('ZIP refuses traversal, normalized duplicate names and unsupported binaries',async()=>{
 const api=createExtractContext(),data=new TextEncoder().encode('answer');
 for(const names of [['../answer.md'],['C:/answer.md'],['a/answer.md','a\\answer.md'],['answer.exe']]){
  const r=await api.extractMaterial({kind:'archive',fileName:'answer.zip'},archiveDownload(buildZip(names.map(name=>({name,data})))));assert.equal(r.ok,false);assert.match(r.reason,/路径|文件类型/);
 }
});
test('ZIP rejects damaged file bytes, excessive nesting and oversized text without partial success',async()=>{
 const api=createExtractContext(),data=new TextEncoder().encode('answer');
 const broken=buildZip([{name:'a.txt',data}]);broken[35]^=1;
 let r=await api.extractMaterial({kind:'archive',fileName:'answer.zip'},archiveDownload(broken));assert.equal(r.ok,false);assert.match(r.reason,/校验/);
 const a=buildZip([{name:'a.txt',data}]),b=buildZip([{name:'b.zip',data:a}]),c=buildZip([{name:'c.zip',data:b}]);
 r=await api.extractMaterial({kind:'archive',fileName:'answer.zip'},archiveDownload(c));assert.equal(r.ok,false);assert.match(r.reason,/嵌套/);
 r=await api.extractMaterial({kind:'archive',fileName:'answer.zip'},archiveDownload(buildZip([{name:'a.txt',data:new TextEncoder().encode('x'.repeat(16001))}])));assert.equal(r.ok,false);assert.match(r.reason,/超过|超限/);
});
test('ZIP does not reinterpret image bytes as text when image reading is unavailable',async()=>{
 const api=createExtractContext();const r=await api.extractMaterial({kind:'archive',fileName:'answer.zip'},archiveDownload(buildZip([{name:'screenshot.png',data:new Uint8Array([1,2,3])}])));
 assert.equal(r.ok,false);assert.match(r.reason,/图像能力/);
});

function spreadsheetFixture({sheet='<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>城市</t></is></c></row>',extra=[]}={}){
 const enc=new TextEncoder(),rows=[['xl/workbook.xml','<workbook><sheets><sheet name="条件表" r:id="rId1" state="hidden"/></sheets></workbook>'],['xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/></Relationships>'],['xl/sharedStrings.xml','<sst><si><t>岗位名称</t></si></sst>'],['xl/worksheets/sheet1.xml','<worksheet><sheetData>'+sheet+'</sheetData><mergeCells><mergeCell ref="A2:B2"/></mergeCells></worksheet>'],...extra];
 return buildZip(rows.map(([name,data])=>({name,data:enc.encode(data)})));
}
test('XLSX preserves cell addresses, hidden sheets, shared strings and merged ranges read only',async()=>{
 const r=await createExtractContext().extractMaterial({kind:'spreadsheet',fileName:'answer.xlsx'},archiveDownload(spreadsheetFixture()));
 assert.equal(r.ok,true,r.reason);assert.equal(r.sheetCount,1);assert.match(r.text,/条件表（hidden）/);assert.match(r.text,/A1=岗位名称 \| B1=城市/);assert.match(r.text,/A2:B2/);assert.match(r.execution,/未重算/);
});
test('XLSX formulas require cached results and never execute, missing shared strings fail closed',async()=>{
 const api=createExtractContext();
 for(const sheet of ['<row><c r="A1"><f>1+1</f></c></row>','<row><c r="A1" t="s"><v>88</v></c></row>']){const r=await api.extractMaterial({kind:'spreadsheet',fileName:'answer.xlsx'},archiveDownload(spreadsheetFixture({sheet})));assert.equal(r.ok,false);assert.match(r.reason,/缓存|索引/);}
 const r=await api.extractMaterial({kind:'spreadsheet',fileName:'answer.xlsx'},archiveDownload(spreadsheetFixture({sheet:'<row><c r="A1"><f>1+1</f><v>2</v></c></row>'})));assert.equal(r.ok,true,r.reason);assert.match(r.text,/A1=2 \[公式缓存，未重算：1\+1\]/);
});
test('XLSX drawings and external-link parts block incomplete text-only grading',async()=>{
 for(const name of ['xl/media/image1.png','xl/externalLinks/externalLink1.xml','xl/charts/chart1.xml']){const r=await createExtractContext().extractMaterial({kind:'spreadsheet',fileName:'answer.xlsx'},archiveDownload(spreadsheetFixture({extra:[[name,'unread material']]})));assert.equal(r.ok,false);assert.match(r.reason,/图片|图表|外部/);}
});
