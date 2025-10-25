// src/prompt-eval.ts
// Evaluates multiple summarization + action detection prompt variants.
// Provides simple precision/recall/F1 metrics over a labeled test set.
// CLI usage:
//   bun run src/prompt-eval.ts --ip 192.168.1.10 --port 2000
// Optional filters:
//   --prompt p1_format_pipe (single variant)
//   --message "Ad-hoc message to test" (runs all prompts on this one message only)
//   --json (output final matrix as JSON)
// Notes: Creates a fresh session per (message,prompt) pair to avoid contamination.

import { sendMessage, createSession } from './oc-client';

interface TestMessage { id: string; text: string; action: boolean }
interface PromptVariant { id: string; prompt: string; parse: (raw: string) => boolean | null }
interface EvalRow { messageId: string; promptId: string; gold: boolean; pred: boolean | null; raw: string }

function argVal(name: string, def?: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return def;
}
function hasFlag(name: string): boolean { return process.argv.includes(`--${name}`); }

const PORT = Number(argVal('port', '2000')); // allow override
const IP = argVal('ip', '192.168.215.4')!;
const BASE = `http://${IP}:${PORT}`;
const singlePrompt = argVal('prompt');
const singleMessage = argVal('message');
const asJson = hasFlag('json');

// Labeled dataset (action=true means user requests guidance or next steps)
const messages: TestMessage[] = singleMessage ? [
  { id: 'adhoc', text: singleMessage, action: /\b(should|how|refactor|fix|could you|please)/i.test(singleMessage) }
] : [
  { id: 'm1', text: 'hey I just created the file what should I do with it', action: true },
  { id: 'm2', text: 'Updated the dependency list; no action needed.', action: false },
  { id: 'm3', text: 'Please refactor the function to improve performance.', action: true },
  { id: 'm4', text: 'I added tests and they pass.', action: false },
  { id: 'm5', text: 'Could you tell me how to deploy this?', action: true },
  { id: 'm6', text: 'Minor README wording tweaks applied.', action: false },
  { id: 'm7', text: 'Need guidance on optimizing memory usage.', action: true },
  { id: 'm8', text: 'Build succeeded after adjusting configs.', action: false }
];

// Helpers to parse each prompt's output into action:boolean
function parsePipe(raw: string): boolean | null {
  const m = raw.match(/\|\s*action\s*=\s*(yes|no)/i);
  if (!m) return null; return m[1].toLowerCase() === 'yes';
}
function parseClassPrefix(raw: string): boolean | null {
  if (/^ACTION_REQUEST\b/i.test(raw)) return true;
  if (/^INFORMATIONAL\b/i.test(raw)) return false;
  return null;
}
function parseJson(raw: string): boolean | null {
  try {
    const j = JSON.parse(raw.trim());
    if (typeof j.action_request === 'boolean') return j.action_request;
    if (typeof j.action === 'boolean') return j.action;
    return null;
  } catch { return null; }
}
function parsePlainIntent(raw: string): boolean | null {
  // Heuristic: contains 'no help' => false; 'needs help' or imperative verbs => true
  if (/no help requested/i.test(raw)) return false;
  if (/needs help|need guidance|should|how to|refactor|deploy/i.test(raw)) return true;
  return null;
}

const prompts: PromptVariant[] = [
  {
    id: 'p1_format_pipe',
    prompt: 'Summarize the previous user message in <=12 words, then append |action=yes if they request help or guidance else |action=no. Output ONLY that line.',
    parse: parsePipe
  },
  {
    id: 'p2_classify_prefix',
    prompt: 'Classify if the previous user message requests action/help: ACTION_REQUEST or INFORMATIONAL; then a 10-word summary. Format: <CLASS> <summary>.',
    parse: parseClassPrefix
  },
  {
    id: 'p3_intent_json',
    prompt: 'Return JSON: {"summary":"<8 word summary>","action_request":true|false} analyzing ONLY the immediately preceding user message.',
    parse: parseJson
  },
  {
    id: 'p4_plain_intent',
    prompt: 'Summarize the previous user message AND indicate if user asks for guidance. Example answer pattern: "agent needs help with file it just created" or "no help requested - dependency update noted". Output one concise sentence.',
    parse: parsePlainIntent
  }
].filter(p => !singlePrompt || p.id === singlePrompt);

async function evaluate(): Promise<void> {
  console.log('▶ Base URL', BASE);
  const rows: EvalRow[] = [];
  for (const msg of messages) {
    for (const pv of prompts) {
      const sessionId = await createSession(BASE, `prompt-eval-${msg.id}-${pv.id}`);
      if (!sessionId) { console.warn('Session create failed', msg.id, pv.id); continue; }
      const send1 = await sendMessage(BASE, sessionId, msg.text);
      if (!send1.ok) { console.warn('Message send failed', msg.id, pv.id, send1.error); continue; }
      const send2 = await sendMessage(BASE, sessionId, pv.prompt);
      if (!send2.ok) { console.warn('Prompt send failed', msg.id, pv.id, send2.error); continue; }
      const raw = send2.replyTexts.join('\n').trim();
      const pred = pv.parse(raw);
      rows.push({ messageId: msg.id, promptId: pv.id, gold: msg.action, pred, raw });
      console.log(`[${msg.id} / ${pv.id}] raw => ${raw}`);
    }
  }
  summarize(rows);
}

function summarize(rows: EvalRow[]): void {
  const byPrompt: Record<string, EvalRow[]> = {};
  rows.forEach(r => { (byPrompt[r.promptId] ||= []).push(r); });
  interface Metrics { promptId: string; tp: number; fp: number; fn: number; tn: number; unk: number; precision: number; recall: number; f1: number }
  const metrics: Metrics[] = [];
  for (const pid of Object.keys(byPrompt)) {
    let tp=0, fp=0, fn=0, tn=0, unk=0;
    for (const r of byPrompt[pid]) {
      if (r.pred === null) { unk++; continue; }
      if (r.gold && r.pred) tp++; else if (!r.gold && r.pred) fp++; else if (r.gold && !r.pred) fn++; else tn++;
    }
    const precision = tp+fp === 0 ? 0 : tp/(tp+fp);
    const recall = tp+fn === 0 ? 0 : tp/(tp+fn);
    const f1 = (precision+recall) === 0 ? 0 : 2*precision*recall/(precision+recall);
    metrics.push({ promptId: pid, tp, fp, fn, tn, unk, precision, recall, f1 });
  }
  if (asJson) {
    console.log(JSON.stringify({ base: BASE, metrics, rows }, null, 2));
    return;
  }
  console.log('\n=== METRICS ===');
  for (const m of metrics) {
    console.log(`${m.promptId}\ttp:${m.tp}\tfp:${m.fp}\tfn:${m.fn}\ttn:${m.tn}\tunk:${m.unk}\tP:${m.precision.toFixed(2)}\tR:${m.recall.toFixed(2)}\tF1:${m.f1.toFixed(2)}`);
  }
  console.log('\n=== ROWS ===');
  for (const r of rows) {
    console.log(`${r.promptId}\t${r.messageId}\tgold:${r.gold}\tpred:${r.pred}\t${r.raw}`);
  }
}

evaluate();
