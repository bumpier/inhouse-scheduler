import OpenAI from "openai";
import { createReadStream } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { env } from "./env";

const exec = promisify(execFile);
let client: OpenAI | null = null;
const openai = () => (client ??= new OpenAI({ apiKey: env.openaiApiKey }));

/** Extract a small mono mp3 from the video. Returns null if there's no audio stream. */
export async function extractAudio(videoPath: string, outPath: string): Promise<boolean> {
  try {
    await exec("ffmpeg", ["-y", "-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", outPath], {
      timeout: 120_000,
    });
    return true;
  } catch (e: any) {
    const msg = String(e?.stderr ?? e?.message ?? "");
    if (/does not contain any stream|Output file is empty|Stream map .* matches no streams/i.test(msg)) return false;
    throw new Error(`ffmpeg failed: ${msg.slice(-400)}`);
  }
}

export async function transcribe(audioPath: string): Promise<string> {
  const r = await openai().audio.transcriptions.create({
    file: createReadStream(audioPath),
    model: env.transcribeModel,
    response_format: "text",
  });
  return typeof r === "string" ? r.trim() : String((r as any).text ?? "").trim();
}

export interface CaptionInput {
  transcript: string;
  setName: string;
  captionPrompt: string;
  avoidTerms: string[];
  previousAttempt?: { caption: string; flagged: string[] };
}

export async function generateCaption(input: CaptionInput): Promise<string> {
  const system = [
    "You write short social media captions for Instagram Reels, TikTok and Facebook Reels.",
    "Rules:",
    "- 1 to 3 sentences, max 200 characters of text, then 3 to 5 relevant hashtags on a new line.",
    "- Natural, human tone. No emojis unless the brand guidance asks for them.",
    "- Focus on the feeling, result, lifestyle or general wellness. Never make medical, drug, dosage or treatment claims.",
    "- Do not name any medication, compound, supplement ingredient or product category that could be a regulated substance.",
    "- Do not use euphemisms, initials, hints or 'you know what I mean' style references to avoid naming something. Just talk about something else.",
    "- No promises or guarantees, no before/after framing, no 'lose X in Y days'.",
    "- Output only the caption text. No quotes, no preamble.",
  ].join("\n");

  const user = [
    `Brand / account set: ${input.setName}`,
    input.captionPrompt ? `Brand guidance: ${input.captionPrompt}` : "",
    input.transcript
      ? `Transcript of the video's audio:\n"""\n${input.transcript.slice(0, 4000)}\n"""`
      : "The video has no speech. Write a general caption that fits the brand guidance.",
    input.previousAttempt
      ? `Your previous attempt was rejected because it contained: ${input.previousAttempt.flagged.join(", ")}. Write a different caption that talks about something else entirely.`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await openai().chat.completions.create({
    model: env.captionModel,
    temperature: 0.8,
    max_tokens: 200,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return (res.choices[0]?.message?.content ?? "").trim().replace(/^["']|["']$/g, "");
}
