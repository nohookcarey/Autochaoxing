(() => {
  const MAX_TEXT_CHARS = 16000;
  const MAX_PDF_PAGES = 20;

  function decodeXmlEntities(text) {
    return String(text)
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");
  }

  async function inflateRaw(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const reader = stream.getReader(), chunks = []; let total = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > 20000000) { await reader.cancel(); throw new Error("DOCX解压内容超限。"); } chunks.push(value); }
    const output = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; } return output;
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let n=0;n<8;n++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    return (crc ^ 0xffffffff) >>> 0;
  }
  async function readZipEntry(buffer, targetName) {
    const view = new DataView(buffer), bytes = new Uint8Array(buffer);
    const bounds = (offset, size) => { if (offset < 0 || size < 0 || offset + size > bytes.length) throw new Error("DOCX文件结构不完整。"); };
    let eocd = -1;
    for (let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--) {
      if (view.getUint32(i,true) === 0x06054b50 && i+22+view.getUint16(i+20,true)===bytes.length) { eocd=i;break; }
    }
    if(eocd<0) throw new Error("docx 解析失败：文件结构异常。");
    if(view.getUint16(eocd+4,true)||view.getUint16(eocd+6,true)) throw new Error("不支持分卷DOCX。");
    const count=view.getUint16(eocd+10,true), start=view.getUint32(eocd+16,true), centralSize=view.getUint32(eocd+12,true);
    if(count>5000||count!==view.getUint16(eocd+8,true)||start+centralSize!==eocd) throw new Error("DOCX目录异常或超限。");
    bounds(start,centralSize);let ptr=start, found=null;const names=new Set();
    for(let i=0;i<count;i++) {
      bounds(ptr,46);if(view.getUint32(ptr,true)!==0x02014b50)throw new Error("DOCX目录结构不完整。");
      const flags=view.getUint16(ptr+8,true), method=view.getUint16(ptr+10,true), crc=view.getUint32(ptr+16,true), compressed=view.getUint32(ptr+20,true), expanded=view.getUint32(ptr+24,true);
      const nameLen=view.getUint16(ptr+28,true), extraLen=view.getUint16(ptr+30,true), commentLen=view.getUint16(ptr+32,true), local=view.getUint32(ptr+42,true);
      bounds(ptr+46,nameLen+extraLen+commentLen);
      const name=new TextDecoder().decode(bytes.subarray(ptr+46,ptr+46+nameLen));
      if(names.has(name))throw new Error("DOCX文件项重复，需人工复核。");names.add(name);
      if(name===targetName) {
        if(flags&1||expanded>20000000)throw new Error("DOCX加密或解压内容超限。");
        bounds(local,30);if(view.getUint32(local,true)!==0x04034b50||view.getUint16(local+8,true)!==method)throw new Error("DOCX文件项结构冲突。");
        const len=view.getUint16(local+26,true), extra=view.getUint16(local+28,true);bounds(local+30,len+extra);
        if(new TextDecoder().decode(bytes.subarray(local+30,local+30+len))!==name)throw new Error("DOCX文件项名称冲突。");
        const dataStart=local+30+len+extra;bounds(dataStart,compressed);if(dataStart+compressed>start)throw new Error("DOCX文件项范围冲突。");
        found={method,crc,expanded,data:bytes.subarray(dataStart,dataStart+compressed)};
      }
      ptr+=46+nameLen+extraLen+commentLen;
    }
    if(ptr!==start+centralSize)throw new Error("DOCX目录长度不一致。");
    if(!found)return null;
    const data=found.method===0?found.data:found.method===8?await inflateRaw(found.data):null;
    if(!data)throw new Error("docx 解析失败：不支持的压缩方式。");
    if(data.length!==found.expanded||crc32(data)!==found.crc)throw new Error("DOCX文件项内容校验失败。");
    return data;
  }

  function docxXmlToText(xml) {
    return decodeXmlEntities(
      String(xml)
        .replace(/<w:tab[^>]*\/>/g, "\t")
        .replace(/<\/w:p>/g, "\n")
        .replace(/<[^>]+>/g, ""),
    );
  }

  async function extractDocxText(buffer) {
    const entry = await readZipEntry(buffer, "word/document.xml");
    if (!entry) throw new Error("docx 解析失败：未找到正文内容。");
    return docxXmlToText(new TextDecoder("utf-8", { fatal: true }).decode(entry));
  }

  let pdfjsPromise;
  async function loadPdfjs() {
    if (!pdfjsPromise) {
      pdfjsPromise = import(chrome.runtime.getURL("vendor/pdfjs/pdf.mjs")).then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdfjs/pdf.worker.mjs");
        return pdfjs;
      });
    }
    return pdfjsPromise;
  }

  async function extractPdfText(bytes) {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true, useSystemFonts: true }).promise;
    try {
      let text = "";
      if (doc.numPages > MAX_PDF_PAGES) throw new Error("PDF 超过20页，不能截断评分，请拆分或人工批改。");
      const pages = doc.numPages;
      for (let i = 1; i <= pages; i += 1) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        text += `${content.items.map((item) => item.str).join(" ")}\n`;
      }
      return text;
    } finally {
      await doc.destroy().catch(() => {});
    }
  }

  function base64ToBytes(base64) {
    const binary = atob(String(base64 || ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function extract(attachment, download) {
    const fileName = String(attachment?.fileName || "");
    if (typeof download !== "function") return { ok: false, reason: "附件下载通道不可用。" };
    if (!["text", "code", "word", "pdf"].includes(attachment?.kind)) return { ok: false, reason: "此类附件无法完整读取，请人工复核。" };
    const downloaded = await download(attachment);
    if (!downloaded?.ok) return { ok: false, reason: downloaded?.reason || "附件下载失败，请人工批改。" };
    let bytes;
    try {
      bytes = base64ToBytes(downloaded.dataBase64);
    } catch {
      return { ok: false, reason: "附件数据解码失败，请人工批改。" };
    }
    const kind = attachment?.kind;
    let text = "";
    try {
      if (kind === "pdf") text = await extractPdfText(bytes);
      else if (kind === "word") {
        if (!/\.docx$/i.test(fileName)) return { ok: false, reason: "旧版 .doc 暂不支持解析，请转换为 .docx 或人工批改。" };
        text = (await extractDocxMaterial(bytes, false)).text;
      } else {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      }
    } catch (error) {
      return { ok: false, reason: `附件解析失败：${String(error?.message || error).slice(0, 120)}` };
    }
    const trimmed = text.replace(/\u0000/g, "").trim();
    if (!trimmed) return { ok: false, reason: "附件中未提取到文本内容（可能是扫描件或图片），请人工批改。" };
    if (trimmed.length > MAX_TEXT_CHARS) return { ok: false, reason: "附件文本超过16000字符，不能截断评分，请拆分或人工批改。" };
    return { ok: true, kind, text: trimmed, truncated: false };
  }

  function imageMime(bytes) {
    if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n)) return "image/png";
    if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
    if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0,4)) === "RIFF" && String.fromCharCode(...bytes.slice(8,12)) === "WEBP") return "image/webp";
    return "";
  }
  async function validateRaster(bytes, mime) {
    if (!mime || bytes.length < 24 || typeof createImageBitmap !== "function") throw new Error("图片无法在浏览器完整解码，需人工复核。");
    if (mime === "image/png") {
      const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), w=v.getUint32(16), h=v.getUint32(20);
      if (!w || !h || w>8192 || h>8192 || w*h>32000000) throw new Error("图片尺寸异常或超限，不缩减后评分。");
    }
    let bitmap;
    try { bitmap=await createImageBitmap(new Blob([bytes],{type:mime}));
      if (!bitmap.width || !bitmap.height || bitmap.width>8192 || bitmap.height>8192 || bitmap.width*bitmap.height>32000000) throw new Error("图片尺寸异常或超限。");
    } catch (e) { throw new Error(`图片完整解码失败：${String(e.message||e).slice(0,80)}`); }
    finally { bitmap?.close(); }
  }
  const xmlAttributes = tag => {
    const result = {};
    for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      if (Object.hasOwn(result, m[1])) throw new Error("DOCX属性重复，需人工复核。");
      result[m[1]] = decodeXmlEntities(m[2] ?? m[3]);
    }
    return result;
  };
  async function extractDocxMaterial(bytes, vision) {
    const entry = await readZipEntry(bytes.buffer, "word/document.xml");
    if (!entry) throw new Error("DOCX正文缺失。");
    const xml = new TextDecoder("utf-8", { fatal: true }).decode(entry);
    if (/<!DOCTYPE|<!ENTITY/.test(xml)) throw new Error("DOCX正文含未支持声明。请转PDF完整读取。");
    if (typeof DOMParser === "function" && new DOMParser().parseFromString(xml, "application/xml").querySelector("parsererror")) throw new Error("DOCX正文XML结构不完整。");
    if (!/<w:document\b/.test(xml) || !/<\/w:document>/.test(xml)) throw new Error("DOCX正文格式未支持。");
    if (/<!DOCTYPE|<!ENTITY|<w:altChunk|<w:object|<w:control|<w:txbxContent|<c:chart|<dgm:|<wps:|<v:shape|<wp:anchor|<a:srcRect|<w:hdr|<w:ftr|<w:headerReference|<w:footerReference|<w:background|<asvg:|<mc:AlternateContent|<m:oMath|<w:del|<w:footnoteReference|<w:endnoteReference/.test(xml)) throw new Error("DOCX含图表、形状、浮动/裁剪图片或其他未支持内容，请转PDF完整读取。");
    const images = [], ids = [];
    for (const m of xml.matchAll(/<a:blip\b[^>]*>/g)) {
      const a = xmlAttributes(m[0]);
      if (a['r:link'] || !a['r:embed']) throw new Error("DOCX图片链接或标识不可核验。");
      ids.push(a['r:embed']);
    }
    if (/<w:drawing|<w:pict|<v:imagedata/.test(xml) && !ids.length) throw new Error("DOCX含无法定位的图形，请转PDF完整读取。");
    const drawings = [...xml.matchAll(/<w:drawing\b[\s\S]*?<\/w:drawing>/g)];
    if (drawings.some(m => !/<pic:pic\b/.test(m[0]) || (m[0].match(/<a:blip\b/g) || []).length !== 1) || drawings.length !== (xml.match(/<w:drawing\b/g) || []).length || drawings.length !== ids.length) throw new Error("DOCX图形结构不完整或不是内嵌图片。");
    if (ids.length > 20) throw new Error("DOCX图片超过20张，不截断评分。");
    if (ids.length && !vision) throw new Error("DOCX包含图片，模型尚未通过图像能力测试，转人工复核。");
    let rels = new Map();
    if (ids.length) {
      const relEntry = await readZipEntry(bytes.buffer, "word/_rels/document.xml.rels");
      if (!relEntry) throw new Error("DOCX图片关系缺失。");
      const relXml = new TextDecoder("utf-8", { fatal: true }).decode(relEntry);
      if (/<!DOCTYPE|<!ENTITY/.test(relXml)) throw new Error("DOCX图片关系含未支持声明。");
      for (const m of relXml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
        const a = xmlAttributes(m[0]);
        if (!a.Id || rels.has(a.Id)) throw new Error("DOCX图片关系标识重复或缺失。");
        rels.set(a.Id, a);
      }
    }
    let imageTotal = 0;
    for (const id of ids) {
      const rel = rels.get(id);
      if (!rel || rel.TargetMode || !/\/image$/.test(rel.Type || "") || !/^media\/[A-Za-z0-9_. -]+$/.test(rel.Target || "") || rel.Target.includes('..')) throw new Error("DOCX图片关系未核验，不读取外部图片。");
      const content = await readZipEntry(bytes.buffer, `word/${rel.Target}`);
      if (!content?.length) throw new Error("DOCX内嵌图片缺失。");
      const mime = imageMime(content); if (!mime) throw new Error("DOCX图片不是支持的PNG/JPEG/WebP，请转PDF。");
      await validateRaster(content, mime);
      let binary = ""; for (let i = 0; i < content.length; i += 8192) binary += String.fromCharCode(...content.subarray(i,i+8192));
      const data = `data:${mime};base64,${btoa(binary)}`; imageTotal += data.length;
      if (imageTotal > 18000000) throw new Error("DOCX图像材料超限，不截断评分。");
      images.push(data);
    }
    let index = 0;
    const text = docxXmlToText(xml.replace(/<a:blip\b[^>]*>/g, () => ` [内嵌图片${++index}] `)).trim();
    if ((!text && !images.length) || text.length > MAX_TEXT_CHARS) throw new Error("DOCX文本为空或超限，需人工复核。");
    return { ok: true, text, images, imageOrder: "正文标记对应原图顺序；不等于Word页面渲染。" };
  }
  function archiveEntries(buffer) {
    const bytes = new Uint8Array(buffer), view = new DataView(buffer);
    let end = -1;
    for (let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--) if(view.getUint32(p,true)===0x06054b50&&p+22+view.getUint16(p+20,true)===bytes.length){end=p;break;}
    if(end<0||view.getUint16(end+4,true)||view.getUint16(end+6,true))throw Error("ZIP目录缺失或为分卷文件。");
    const count=view.getUint16(end+10,true),start=view.getUint32(end+16,true),size=view.getUint32(end+12,true);
    if(count>500||count!==view.getUint16(end+8,true)||start+size!==end)throw Error("ZIP目录异常或文件数超过500。");
    let p=start,total=0;const result=[],names=new Set();
    for(let i=0;i<count;i++){
      if(p+46>end||view.getUint32(p,true)!==0x02014b50)throw Error("ZIP目录不完整。");
      const len=view.getUint16(p+28,true),extra=view.getUint16(p+30,true),comment=view.getUint16(p+32,true),expanded=view.getUint32(p+24,true),flags=view.getUint16(p+8,true),attrs=view.getUint32(p+38,true);
      if(p+46+len+extra+comment>end)throw Error("ZIP目录边界异常。");
      const name=new TextDecoder().decode(bytes.subarray(p+46,p+46+len)),normalized=name.replaceAll('\\','/').normalize('NFC');
      if(!name||/[\u0000-\u001f]/.test(name)||/^(?:\/|[A-Za-z]:)/.test(normalized)||normalized.split('/').includes('..')||names.has(normalized)||((attrs>>>16)&0xf000)===0xa000)throw Error("ZIP路径、重复文件或符号链接不安全。");
      names.add(normalized);total+=expanded;
      if(flags&1||expanded>20000000||total>50000000)throw Error("ZIP加密或展开内容超限，未截断评分。");
      if(!normalized.endsWith('/'))result.push({name,normalized,expanded});
      p+=46+len+extra+comment;
    }
    if(p!==end)throw Error("ZIP目录长度不一致。");
    return result;
  }
  async function extractSpreadsheetMaterial(bytes) {
    const entries=archiveEntries(bytes.buffer);
    if(entries.some(e=>/^xl\/(?:media|drawings|charts|embeddings|externalLinks)\//.test(e.normalized)||/vbaProject/i.test(e.normalized)))throw Error("XLSX含图片、图表、嵌入或外部连接，需人工核对完整材料。");
    const xml=async name=>{const b=await readZipEntry(bytes.buffer,name);if(!b)return '';const s=new TextDecoder('utf-8',{fatal:true}).decode(b);if(/<!DOCTYPE|<!ENTITY/i.test(s))throw Error('XLSX XML声明不安全');return s;};
    const attr=(s,n)=>decodeXmlEntities((s.match(new RegExp('(?:^|\\s)'+n+'\\s*=\\s*["\\\']([^"\\\']*)["\\\']'))||[])[1]||'');
    const values=s=>[...s.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map(m=>decodeXmlEntities(m[1])).join('');
    const workbook=await xml('xl/workbook.xml'),relationships=await xml('xl/_rels/workbook.xml.rels');
    if(!workbook||!relationships)throw Error('XLSX工作簿及工作表关系未获取');
    const shared=[...(await xml('xl/sharedStrings.xml')).matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)].map(m=>values(m[1]));
    const relations=new Map([...relationships.matchAll(/<Relationship\b([^>]*?)\/?\s*>/g)].map(m=>[attr(m[1],'Id'),{target:attr(m[1],'Target'),external:attr(m[1],'TargetMode')==='External',type:attr(m[1],'Type')}]));
    const sheets=[];let cells=0;
    for(const sheet of workbook.matchAll(/<(?:\w+:)?sheet\b([^>]*?)\/?\s*>/g)){
      const attributes=sheet[1],r=relations.get(attr(attributes,'r:id'));if(!r||r.external||!/\/worksheet$/.test(r.type))throw Error('XLSX工作表关系不完整');
      const target=r.target.replace(/^\/xl\//,'');if(!/^worksheets\/[^/]+\.xml$/.test(target))throw Error('XLSX工作表路径不安全');
      const body=await xml('xl/'+target);if(!body||/<(?:\w+:)?(?:drawing|legacyDrawing|oleObjects)\b/.test(body))throw Error('XLSX工作表未完整读取');
      const lines=[];
      for(const row of body.matchAll(/<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/g)){
        const line=[];
        for(const cell of row[2].matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)){
          if(++cells>10000)throw Error('XLSX单元格超限，未截断评分');
          const address=attr(cell[1],'r'),type=attr(cell[1],'t'),content=cell[2]||'',v=(content.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/)||[])[1],f=(content.match(/<(?:\w+:)?f\b[^>]*>([\s\S]*?)<\/(?:\w+:)?f>/)||[])[1];
          if(!/^[A-Z]{1,3}[1-9]\d*$/.test(address))throw Error('XLSX单元格地址缺失');
          let value=type==='inlineStr'?values(content):decodeXmlEntities(v||'');
          if(type==='s'){const index=Number(v);if(v===undefined||!Number.isInteger(index)||index<0||index>=shared.length)throw Error('XLSX共享文本索引未获取');value=shared[index];}
          if(f!==undefined){if(v===undefined)throw Error('XLSX公式没有缓存值，不能假定计算结果');value+=' [公式缓存，未重算：'+decodeXmlEntities(f)+']';}
          if(value)line.push(address+'='+value);
        }
        if(line.length)lines.push(line.join(' | '));
      }
      const merges=[...body.matchAll(/<(?:\w+:)?mergeCell\b([^>]*?)\/?\s*>/g)].map(m=>attr(m[1],'ref'));
      sheets.push({name:attr(attributes,'name'),state:attr(attributes,'state')||'visible',rows:lines,mergedRanges:merges});
    }
    if(!sheets.length||!sheets.some(s=>s.rows.length))throw Error('XLSX工作表或作答内容未获取');
    const text=sheets.map((s,n)=>`工作表${n+1}：${s.name}（${s.state}）\n${s.mergedRanges.length?'合并区域：'+s.mergedRanges.join(',')+'\n':''}${s.rows.join('\n')}`).join('\n\n');
    if(text.length>MAX_TEXT_CHARS)throw Error('XLSX文字超限，未截断评分');
    return {ok:true,text,images:[],sheetCount:sheets.length,execution:'仅静态读取所有工作表，未重算公式、未访问外部链接'};
  }
  async function extractArchiveMaterial(bytes, vision, archiveDepth) {
    if(archiveDepth>=2)throw Error("ZIP嵌套超过两层，需人工复核。");
    const entries=archiveEntries(bytes.buffer),files=[];let totalText=0,totalImages=0;
    for(const entry of entries){
      const name=entry.normalized;
      if(name.startsWith('__MACOSX/')||/(?:^|\/)(?:\.DS_Store|Thumbs\.db)$/.test(name))continue;
      const data=await readZipEntry(bytes.buffer,entry.name);
      if(!data)throw Error("ZIP文件项未完整读取。");
      let kind;
      if(/\.zip$/i.test(name))kind='archive';else if(/\.xlsx$/i.test(name))kind='spreadsheet';else if(/\.docx$/i.test(name))kind='word';else if(/\.pdf$/i.test(name))kind='pdf';else if(/\.(png|jpe?g|webp)$/i.test(name))kind='image';else if(/\.(txt|md|markdown|csv|json|xml|log|yml|yaml|ini|tex|py|js|ts|jsx|tsx|html|css|vue|sql|java|c|cpp|h|sh|bat|ps1|ipynb)$/i.test(name)||/(?:^|\/)(?:LICENSE|Dockerfile|Makefile|\.gitignore)$/i.test(name))kind='text';else throw Error("ZIP含未支持文件类型，不能忽略后评分。");
      let encoded='';for(let p=0;p<data.length;p+=32768)encoded+=String.fromCharCode(...data.subarray(p,p+32768));
      const item=await extractMaterial({kind,fileName:name},async()=>({ok:true,dataBase64:btoa(encoded)}),{vision,archiveDepth:archiveDepth+1});
      if(!item.ok)throw Error(item.reason||"ZIP文件项读取失败。");
      totalText+=(item.text||'').length;totalImages+=(item.images||[]).reduce((n,s)=>n+s.length,0);
      if(totalText>48000||totalImages>18000000)throw Error("ZIP材料超限，未截断评分。");
      files.push({fileName:name,kind,...item});
    }
    if(!files.length)throw Error("ZIP没有可核验的作答文件。");
    return {ok:true,text:files.map(f=>`文件：${f.fileName}\n${f.text||''}`).join('\n\n'),images:files.flatMap(f=>f.images||[]),files,archiveComplete:true,execution:'仅静态读取，未执行任何文件'};
  }
  async function extractMaterial(attachment, download, { vision = false, archiveDepth = 0 } = {}) {
    if (!["image","pdf","word","archive","spreadsheet"].includes(attachment.kind)) return extract(attachment, download);
    const result = await download(attachment);
    if (!result?.ok) return { ok: false, reason: result?.reason || "附件未获取。" };
    let bytes;
    try { bytes = base64ToBytes(result.dataBase64); } catch { return { ok: false, reason: "附件数据解码失败。" }; }
    if (bytes.length > 15000000) return { ok: false, reason: "附件超过15MB，请拆分或人工复核。" };
    try {
      if (attachment.kind === "archive") return { ...await extractArchiveMaterial(bytes, vision, archiveDepth), contentKey: globalThis.LearningTongBatch.digest(result.dataBase64) };
      if (attachment.kind === "spreadsheet") return { ...await extractSpreadsheetMaterial(bytes), contentKey: globalThis.LearningTongBatch.digest(result.dataBase64) };
      if (attachment.kind === "image") {
        if (!vision) return { ok: false, reason: "模型尚未通过图像能力测试，图片转人工复核。" };
        const mime = imageMime(bytes);
        if (!mime) return { ok: false, reason: "仅支持已验证的PNG、JPEG和WebP图片，请转换或人工处理。" };
        await validateRaster(bytes, mime);
        return { ok: true, text: "", images: [`data:${mime};base64,${result.dataBase64}`], contentKey: globalThis.LearningTongBatch.digest(result.dataBase64) };
      }
      if (attachment.kind === "word") {
        if (!/\.docx$/i.test(attachment.fileName)) return { ok: false, reason: "旧版.doc需转换为.docx。" };
        return { ...await extractDocxMaterial(bytes, vision), contentKey: globalThis.LearningTongBatch.digest(result.dataBase64) };
      }
      const pdfjs = await loadPdfjs();
      const pdf = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: true }).promise;
      try {
        if (pdf.numPages > MAX_PDF_PAGES) throw new Error("PDF超过20页，不能截断评分。");
        let text = ""; const images = []; let scan = false;
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p), content = await page.getTextContent();
          const pageText = content.items.map(i => i.str).join(" ").trim();
          if (!pageText) scan = true;
          text += `第${p}页\n${pageText}\n`;
          if (vision) {
            const viewport = page.getViewport({ scale: Math.min(1.5, 1600 / page.getViewport({ scale: 1 }).width) });
            const canvas = document.createElement("canvas"); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
            await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
            images.push(canvas.toDataURL("image/jpeg", 0.8)); canvas.width = canvas.height = 0;
          } else {
            const operations = await page.getOperatorList();
            if (operations.fnArray.some(op => [pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject].includes(op))) scan = true;
          }
        }
        if (scan && !vision) throw new Error("PDF含扫描页或图片，需通过图像能力测试后完整读取。");
        if (text.length > MAX_TEXT_CHARS || images.reduce((sum, s) => sum + s.length, 0) > 18000000) throw new Error("PDF材料超限，请拆分或人工复核，未截断评分。");
        return { ok: true, text, images, contentKey: globalThis.LearningTongBatch.digest(result.dataBase64) };
      } finally { await pdf.destroy(); }
    } catch (e) { return { ok: false, reason: `附件无法完整读取：${String(e.message || e).slice(0, 160)}` }; }
  }
  globalThis.LearningTongAttachmentExtract = Object.freeze({ extract, extractMaterial, extractSpreadsheetMaterial, extractArchiveMaterial, archiveEntries, extractDocxMaterial, imageMime, validateRaster, crc32, extractDocxText, docxXmlToText, readZipEntry, decodeXmlEntities, base64ToBytes });
})();
