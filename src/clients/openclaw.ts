import { config } from '../config.js';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

function voiceSystemPrompt(agentName: string) {
  return `You are ${agentName}, a personal AI voice assistant. Reply naturally and concisely for a spoken voice conversation.`;
}

export async function probeOpenClaw() {
  const base = config.openclaw.baseUrl.replace(/\/$/, '');
  const root = await fetch(`${base}/`);
  const models = await fetch(`${base}/v1/models`, {
    headers: authHeaders(),
  });
  return {
    root: { status: root.status, contentType: root.headers.get('content-type') },
    models: {
      status: models.status,
      contentType: models.headers.get('content-type'),
      bodyPreview: (await models.text()).slice(0, 500),
    },
  };
}

export async function askOpenClaw(userText: string, history: ChatMessage[] = []) {
  const base = config.openclaw.baseUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'content-type': 'application/json',
      'x-openclaw-session-key': config.openclaw.sessionKey,
      'x-openclaw-message-channel': config.openclaw.messageChannel,
    },
    body: JSON.stringify({
      model: config.openclaw.model,
      stream: false,
      user: config.openclaw.sessionKey,
      messages: buildMessages(userText, history),
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OpenClaw ${res.status}: ${text.slice(0, 800)}`);
  }

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`OpenClaw returned non-JSON. Is /v1/chat/completions enabled? ${text.slice(0, 300)}`);
  }

  const answer = json?.choices?.[0]?.message?.content;
  if (!answer) {
    throw new Error(`OpenClaw response missing choices[0].message.content: ${text.slice(0, 800)}`);
  }
  return String(answer);
}

export async function streamOpenClaw(
  userText: string,
  history: ChatMessage[] = [],
  onDelta: (delta: string) => void | Promise<void>,
  signal?: AbortSignal,
) {
  const base = config.openclaw.baseUrl.replace(/\/$/, '');
  const requestInit: RequestInit = {
    method: 'POST',
    headers: {
      ...authHeaders(),
      accept: 'text/event-stream',
      'content-type': 'application/json',
      'x-openclaw-session-key': config.openclaw.sessionKey,
      'x-openclaw-message-channel': config.openclaw.messageChannel,
    },
    body: JSON.stringify({
      model: config.openclaw.model,
      stream: true,
      user: config.openclaw.sessionKey,
      messages: buildMessages(userText, history),
    }),
  };
  if (signal) requestInit.signal = signal;

  const res = await fetch(`${base}/v1/chat/completions`, requestInit);

  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new Error(`OpenClaw stream ${res.status}: ${text.slice(0, 800)}`);
  }

  let full = '';
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of res.body as any as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || '';
    for (const event of events) {
      for (const line of event.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let json: any;
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        const delta = json?.choices?.[0]?.delta?.content ?? json?.choices?.[0]?.message?.content ?? '';
        if (delta) {
          full += String(delta);
          await onDelta(String(delta));
        }
      }
    }
  }

  return full;
}

function buildMessages(userText: string, history: ChatMessage[]) {
  return [
    { role: 'system', content: voiceSystemPrompt(config.agentName) },
    ...history.slice(-8),
    { role: 'user', content: userText },
  ];
}

function authHeaders() {
  return config.openclaw.apiKey
    ? { authorization: `Bearer ${config.openclaw.apiKey}` }
    : {};
}
