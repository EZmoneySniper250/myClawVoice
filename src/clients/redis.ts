import Redis from 'ioredis';

const HISTORY_KEY = 'myvoice:messages';
const MAX_STORED  = 500;

export type StoredMessage = { role: 'user' | 'assistant'; content: string };

function makeClient(): Redis | null {
  try {
    const client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      lazyConnect: true,
      enableOfflineQueue: false,
      commandTimeout: 2000,
      maxRetriesPerRequest: 1,
    });
    client.on('error', (err: Error) => console.warn('[Redis]', err.message));
    return client;
  } catch {
    return null;
  }
}

const client = makeClient();

export async function loadRecent(count = 50): Promise<StoredMessage[]> {
  if (!client) return [];
  try {
    const items = await client.lrange(HISTORY_KEY, -count, -1);
    return items.map(s => JSON.parse(s) as StoredMessage);
  } catch {
    return [];
  }
}

export async function appendMessages(
  userText: string,
  assistantText: string,
): Promise<void> {
  if (!client) return;
  try {
    await client.rpush(
      HISTORY_KEY,
      JSON.stringify({ role: 'user',      content: userText      }),
      JSON.stringify({ role: 'assistant', content: assistantText }),
    );
    await client.ltrim(HISTORY_KEY, -MAX_STORED, -1);
  } catch {
    // silently ignore write errors
  }
}
