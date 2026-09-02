function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export const env = {
  get appUrl() {
    return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  },
  get sessionSecret() {
    return req("SESSION_SECRET");
  },
  get zernioApiKey() {
    return req("ZERNIO_API_KEY");
  },
  get zernioWebhookSecret() {
    return process.env.ZERNIO_WEBHOOK_SECRET ?? "";
  },
  get openaiApiKey() {
    return req("OPENAI_API_KEY");
  },
  get captionModel() {
    return process.env.OPENAI_CAPTION_MODEL ?? "gpt-4o-mini";
  },
  get transcribeModel() {
    return process.env.OPENAI_TRANSCRIBE_MODEL ?? "whisper-1";
  },
  get uploadDir() {
    return process.env.UPLOAD_DIR ?? "./data/uploads";
  },
  get submitLeadDays() {
    return Number(process.env.SUBMIT_LEAD_DAYS ?? 3);
  },
  get minGapMinutes() {
    return Number(process.env.MIN_GAP_MINUTES ?? 10);
  },
};
