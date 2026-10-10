import ffmpeg from "fluent-ffmpeg";
import fs from "node:fs";
import path from "node:path";
import { transitionOverlap, type TransitionType } from "./export-options";

export function runFfmpeg(command: ReturnType<typeof ffmpeg>): Promise<void> {
  return new Promise((resolve, reject) => command.on("end", () => resolve()).on("error", err => reject(new Error("FFmpeg assembly failed: " + err.message))).run());
}
export async function probeVideo(file: string): Promise<{ duration: number; width: number; height: number; audio: boolean; signature: string }> {
  return new Promise((resolve, reject) => ffmpeg.ffprobe(path.resolve(file), (error, data) => {
    if (error) { reject(error); return; }
    const video = data.streams.find(s => s.codec_type === "video");
    const duration = Number(video?.duration ?? data.format.duration);
    if (!video?.width || !video.height || !Number.isFinite(duration) || duration <= 0) { reject(new Error("Invalid video clip: " + file)); return; }
    const signature = JSON.stringify(data.streams.filter(s => s.codec_type === "video" || s.codec_type === "audio").map(s => [s.codec_type, s.codec_name, s.profile, s.codec_tag_string, s.width, s.height, s.pix_fmt, s.sample_aspect_ratio, s.r_frame_rate, s.time_base, s.sample_rate, s.channels, s.channel_layout]));
    resolve({ duration, width: video.width, height: video.height, audio: data.streams.some(s => s.codec_type === "audio"), signature });
  }));
}
export async function renderTransitions(videoPaths: string[], transitions: TransitionType[], durations: number[], outputPath: string) {
  if (videoPaths.length === 1) { fs.copyFileSync(path.resolve(videoPaths[0]), outputPath); return; }
  const info = await Promise.all(videoPaths.map(probeVideo));
  if (transitions.every(t => t === "cut") && info.every(clip => clip.signature === info[0].signature)) {
    const list = outputPath + ".txt";
    fs.writeFileSync(list, videoPaths.map(p => "file '" + path.resolve(p).split(path.sep).join("/").replace(/'/g, "'\\'") + "'").join("\n"));
    try { await runFfmpeg(ffmpeg().input(list).inputOptions(["-f", "concat", "-safe", "0"]).outputOptions(["-c", "copy"]).output(outputPath)); }
    finally { fs.rmSync(list, { force: true }); }
    return;
  }
  // Decode at most two short source spans at once instead of 31 full videos.
  const width = Math.floor(info[0].width / 2) * 2;
  const height = Math.floor(info[0].height / 2) * 2;
  const overlaps = transitions.map((t, i) => transitionOverlap(t, durations[i], durations[i + 1]));
  const work = fs.mkdtempSync(path.join(path.dirname(outputPath), "assemble-"));
  const parts: string[] = [];
  const vf = "fps=30,settb=AVTB,setpts=PTS-STARTPTS,scale=" + width + ":" + height + ":force_original_aspect_ratio=decrease,pad=" + width + ":" + height + ":(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p";
  const audio = (index: number, hasAudio: boolean, duration: number, label: string) => (hasAudio ? "[" + index + ":a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS,apad" : "anullsrc=r=48000:cl=stereo") + ",atrim=duration=" + duration + ",asetpts=PTS-STARTPTS[" + label + "]";
  const encoding = ["-filter_complex_threads", "1", "-map", "[vout]", "-map", "[aout]", "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", "-ac", "2"];
  try {
    for (let i = 0; i < videoPaths.length; i++) {
      const incoming = overlaps[i - 1] ?? 0;
      const outgoing = overlaps[i] ?? 0;
      const duration = durations[i] - incoming - outgoing;
      if (duration > 0) {
        const body = path.join(work, "body-" + i + ".mp4");
        const command = ffmpeg().input(path.resolve(videoPaths[i])).inputOptions(["-ss", String(incoming), "-t", String(duration)]);
        await runFfmpeg(command.complexFilter("[0:v]" + vf + "[vout];" + audio(0, info[i].audio, duration, "aout")).outputOptions([...encoding, "-t", String(duration)]).output(body));
        parts.push(body);
      }
      if (outgoing > 0) {
        const bridge = path.join(work, "bridge-" + i + ".mp4");
        const command = ffmpeg().input(path.resolve(videoPaths[i])).inputOptions(["-ss", String(durations[i] - outgoing), "-t", String(outgoing)])
          .input(path.resolve(videoPaths[i + 1])).inputOptions(["-t", String(outgoing)]);
        const transition = transitions[i] === "fade_in" || transitions[i] === "fade_out" ? "fade" : transitions[i];
        const filter = "[0:v]" + vf + "[v0];[1:v]" + vf + "[v1];[v0][v1]xfade=transition=" + transition + ":duration=" + outgoing + ":offset=0[vout];" + audio(0, info[i].audio, outgoing, "a0") + ";" + audio(1, info[i + 1].audio, outgoing, "a1") + ";[a0][a1]acrossfade=d=" + outgoing + ":c1=tri:c2=tri[aout]";
        await runFfmpeg(command.complexFilter(filter).outputOptions([...encoding, "-t", String(outgoing)]).output(bridge));
        parts.push(bridge);
      }
    }
    const list = path.join(work, "concat.txt");
    fs.writeFileSync(list, parts.map(p => "file '" + p.split(path.sep).join("/") + "'").join("\n"));
    await runFfmpeg(ffmpeg().input(list).inputOptions(["-f", "concat", "-safe", "0"]).outputOptions(["-c", "copy"]).output(outputPath));
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}
