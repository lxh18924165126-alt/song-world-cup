export interface AppEvent {
  id: string;
  type: "playlist_imported" | "tournament_started" | "tournament_finished" | "share_opened";
  subjectId: string | null;
  payload: Record<string, string | number | boolean | null>;
  occurredAt: string;
}

export function appEvent(
  type: AppEvent["type"],
  subjectId: string | null,
  payload: AppEvent["payload"] = {},
): AppEvent {
  return { id: crypto.randomUUID(), type, subjectId, payload, occurredAt: new Date().toISOString() };
}

export async function consumeAppEvents(db: D1Database, batch: MessageBatch<AppEvent>): Promise<void> {
  const receivedAt = new Date().toISOString();
  await db.batch(batch.messages.map((message) => db.prepare(`
    INSERT OR IGNORE INTO app_events (id, type, subject_id, payload_json, occurred_at, received_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    message.body.id,
    message.body.type,
    message.body.subjectId,
    JSON.stringify(message.body.payload),
    message.body.occurredAt,
    receivedAt,
  )));
}
