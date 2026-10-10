const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'export-test-'));
process.env.UPLOAD_DIR = tmp;
const ff = process.env.FFMPEG_PATH || 'ffmpeg';
const fp = process.env.FFPROBE_PATH || 'ffprobe';
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const full = path.join(root, file);
  const m = new Module(full, module); m.filename = full; m.paths = module.paths; cache.set(file, m);
  m.require = id => id === '@/lib/id' ? { id: () => require('node:crypto').randomUUID() } : id.startsWith('./') ? load(path.join(path.dirname(file), id + '.ts')) : require(id);
  m._compile(ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, full);
  return m.exports;
}
const options = load('src/lib/video/export-options.ts');
const { assembleVideo } = load('src/lib/video/ffmpeg.ts');
const { createVideoArchive } = load('src/lib/video/clip-archive.ts');
const { confirmPreview } = load('src/lib/video/preview-update.ts');
const { readExportSettings, writeExportSettings } = load('src/lib/video/export-metadata.ts');
test('export metadata is tied to the rendered file and rejects malformed options', () => {
  const file=path.join(tmp,'metadata.mp4'), settings={subtitlesEnabled:false,transition:'cut',mode:'keyframe',versionId:'v2'};
  assert.equal(readExportSettings(file),null);
  writeExportSettings(file,settings); assert.deepEqual(readExportSettings(file),settings);
  fs.writeFileSync(file+'.export.json','{"transition":"invalid"}'); assert.equal(readExportSettings(file),null);
});
test('preview confirmation only publishes verified media and captured settings', async () => {
  const settings={subtitlesEnabled:false,transition:'cut',mode:'keyframe',versionId:'v2'};
  const result=await confirmPreview(settings,async input=>{ assert.deepEqual(input,settings); input.transition='fade'; return {status:'ok',outputPath:'new.mp4'}; },async file=>file==='new.mp4');
  assert.deepEqual(result,{outputPath:'new.mp4',settings});
  await assert.rejects(confirmPreview(settings,async()=>{throw Error('render failed');},async()=>true),/render failed/);
  await assert.rejects(confirmPreview(settings,async()=>({status:'error'}),async()=>true),/Invalid assembly response/);
  await assert.rejects(confirmPreview(settings,async()=>({status:'ok',outputPath:'missing.mp4'}),async()=>false),/unavailable/);
});
const probe = f => JSON.parse(execFileSync(fp, ['-v','error','-show_streams','-show_format','-of','json',path.resolve(f)], { encoding:'utf8' }));
test('export options and real media', async t => {
  t.after(() => fs.rmSync(tmp,{recursive:true,force:true}));
  await t.test('defaults and validation', () => {
    assert.deepEqual(options.parseExportOptions(),{subtitlesEnabled:true,transition:'shot',mode:undefined});
    assert.throws(() => options.parseExportOptions({transition:'evil'}));
    assert.throws(() => options.parseExportOptions({subtitlesEnabled:'false'}));
    assert.throws(() => options.parseExportOptions({mode:'both'}));
  });
  const clips = ['red','blue','green'].map((color,i) => {
    const output=path.join(tmp,'clip-'+i+'.mp4');
    const args=['-y','-f','lavfi','-i','color=c='+color+':s='+(i===1?'96x96':'160x90')+':r=30:d=1.2'];
    if(i!==1) args.push('-f','lavfi','-i','sine=frequency='+ (440+i*220) +':duration=1.2','-c:a','aac');
    args.push('-c:v','libx264','-pix_fmt','yuv420p',output);
    execFileSync(ff,args,{stdio:'ignore'}); return output;
  });
  const subtitles=[{text:'Hello',shotSequence:2,dialogueSequence:0,dialogueCount:1}];
  const run = (transition,enabled=false,paths=clips) => assembleVideo({videoPaths:paths,subtitles,projectId:'test',shotDurations:paths.map(()=>99),transitions:paths.slice(1).map(()=>transition),subtitlesEnabled:enabled});
  await t.test('subtitle on creates SRT at actual media time; off does not', async () => {
    const off=await run('cut',false,[clips[0],clips[2]]); assert.equal(off.srtPath,undefined);
    const on=await run('cut',true,[clips[0],clips[2]]); assert.match(fs.readFileSync(on.srtPath,'utf8'),/00:00:01,199|00:00:01,200/);
    assert.ok(probe(on.videoPath).streams.some(s=>s.codec_type==='audio'));
  });
  await t.test('hard cut normalizes silent/different-size clips', async () => {
    const result=await run('cut'); const data=probe(result.videoPath);
    assert.ok(data.streams.some(s=>s.codec_type==='audio'));
    assert.equal(data.streams.find(s=>s.codec_type==='video').width,160);
    assert.ok(Math.abs(Number(data.format.duration)-3.6)<0.25,data.format.duration);
    execFileSync(ff,['-v','error','-i',path.resolve(result.videoPath),'-f','null','-'],{stdio:'pipe'});
  });
  for(const transition of options.TRANSITIONS.filter(v=>v!=='cut')) await t.test('real transition '+transition+' preserves audio and handles silent/different-size clip',async () => {
    const result=await run(transition); const data=probe(result.videoPath);
    assert.ok(data.streams.some(s=>s.codec_type==='audio'));
    assert.ok(Math.abs(Number(data.format.duration)-2.8)<0.25, data.format.duration);
    execFileSync(ff,['-v','error','-i',path.resolve(result.videoPath),'-f','null','-'],{stdio:'pipe'});
  });
  await t.test('31 clips mixed transitions preserve timing and audio', async () => {
    const paths=Array.from({length:31},(_,i)=>clips[i%3]);
    const transitions=paths.slice(1).map((_,i)=>i%2?'fade':'cut');
    const result=await assembleVideo({videoPaths:paths,subtitles:[],projectId:'stress',shotDurations:paths.map(()=>99),transitions,subtitlesEnabled:false});
    const data=probe(result.videoPath);
    assert.ok(data.streams.some(s=>s.codec_type==='audio'));
    assert.ok(Math.abs(Number(data.format.duration)-(31*1.2-15*0.4))<1.5,data.format.duration);
    execFileSync(ff,['-v','error','-i',path.resolve(result.videoPath),'-f','null','-'],{stdio:'pipe'});
  });
  await t.test('single clip and missing clip', async () => {
    const result=await run('cut',false,[clips[0]]); assert.ok(probe(result.videoPath));
    await assert.rejects(run('cut',false,[path.join(tmp,'missing.mp4')]));
  });
  await t.test('ZIP entries retain original bytes and reject missing/outside files', async () => {
    const response=await createVideoArchive(clips.map((source,i)=>({sequence:i+1,source})),'test');
    const zip=Buffer.from(await response.arrayBuffer());
    const end=zip.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
    const count=zip.readUInt16LE(end+10); assert.equal(count,clips.length);
    let cursor=zip.readUInt32LE(end+16);
    for(let i=0;i<count;i++) {
      assert.equal(zip.readUInt32LE(cursor),0x02014b50);
      assert.equal(zip.readUInt16LE(cursor+10),0);
      const size=zip.readUInt32LE(cursor+24), nameLen=zip.readUInt16LE(cursor+28), extra=zip.readUInt16LE(cursor+30), comment=zip.readUInt16LE(cursor+32), offset=zip.readUInt32LE(cursor+42);
      assert.equal(zip.subarray(cursor+46,cursor+46+nameLen).toString(),'shot-00'+(i+1)+'.mp4');
      const start=offset+30+zip.readUInt16LE(offset+26)+zip.readUInt16LE(offset+28);
      assert.deepEqual(zip.subarray(start,start+size),fs.readFileSync(clips[i]));
      cursor+=46+nameLen+extra+comment;
    }
    await assert.rejects(createVideoArchive([{sequence:1}],'missing'));
    await assert.rejects(createVideoArchive([{sequence:1,source:path.join(root,'package.json')}],'outside'));
  });
});
