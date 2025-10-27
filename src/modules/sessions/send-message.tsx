import { Elysia } from 'elysia';
import { dataStarPatchElementsSSE } from '../../../rendering/datastar';
import { doesIpExist } from '../../utils/store-ips';
import { listMessages, sendMessage as rawSendMessage, FIRST_MESSAGE_INSTRUCTION } from '../../oc-client';

// Ephemeral tracking for first-message injection (session scoped)
const firstMessageSeen = new Set<string>();
const inFlightFirstMessage: Record<string, boolean> = {};

function resolveBaseUrl(ip: string) {
  return `http://${ip}:2000`;
}

export const sendMessagePlugin = new Elysia({ name: 'sessions-send-message' }).post(
  '/sessions/:ip/:sid/message',
  async function* ({ params, request }) {
    const { ip, sid } = params as { ip: string; sid: string };
    if (!ip || !sid || !(await doesIpExist(ip))) {
      yield dataStarPatchElementsSSE(
        <div id='session-message-status' class='status'>Unknown IP</div>,
      );
      yield dataStarPatchElementsSSE(
        <div id='session-message-result' class='result'>Error</div>,
      );
      return;
    }
    // Initial status patch
    yield dataStarPatchElementsSSE(
      <div id='session-message-status' class='status'>Sending...</div>,
    );
    let bodyText = '';
    try {
      bodyText = await request.text();
    } catch {}
    let text = '';
    if (bodyText) {
      try {
        const parsed = JSON.parse(bodyText);
        if (typeof parsed.messageText === 'string' && parsed.messageText.trim()) text = parsed.messageText.trim();
        else if (typeof parsed.messagetext === 'string' && parsed.messagetext.trim()) text = parsed.messagetext.trim();
        else if (typeof parsed.text === 'string' && parsed.text.trim()) text = parsed.text.trim();
        else if (Array.isArray(parsed.parts)) {
          const part = parsed.parts.find((p: any) => p?.type === 'text');
          if (part && typeof part.text === 'string' && part.text.trim()) text = part.text.trim();
        }
      } catch {
        /* ignore */
      }
    }
    if (!text) {
      yield dataStarPatchElementsSSE(
        <div id='session-message-result' class='result'>No text</div>,
      );
      return;
    }
    const sessionKey = sid;
    let injected = false;
    try {
      if (!firstMessageSeen.has(sessionKey) && !inFlightFirstMessage[sessionKey]) {
        inFlightFirstMessage[sessionKey] = true;
        let existingCount = 0;
        try {
          const existing = await listMessages(resolveBaseUrl(ip), sid).catch(() => []);
          existingCount = existing.length;
        } catch {}
        if (existingCount === 0) {
          text = FIRST_MESSAGE_INSTRUCTION + '\n\n' + text;
          injected = true;
        }
        firstMessageSeen.add(sessionKey);
        delete inFlightFirstMessage[sessionKey];
      }
    } catch {
      delete inFlightFirstMessage[sessionKey];
    }
    console.log('Elysia message send start', { ip, sid, text, injected });
    const result = await rawSendMessage(resolveBaseUrl(ip), sid, text);
    if (!result.ok) {
      const msg = result.error || `HTTP ${result.status}`;
      yield dataStarPatchElementsSSE(
        <div id='session-message-status' class='status'>Failed</div>,
      );
      yield dataStarPatchElementsSSE(
        <div id='session-message-result' class='result'>Error: {msg}</div>,
      );
      return;
    }
    const joined = result.replyTexts.join('\n') || '(no reply)';
    const truncated = joined.substring(0, 50) + (joined.length > 50 ? '...' : '');
    yield dataStarPatchElementsSSE(
      <div id='session-message-status' class='status'>Done</div>,
    );
    yield dataStarPatchElementsSSE(
      <div id='session-message-result' class='result'>Reply: {truncated}</div>,
    );
  },
);
