import crypto from 'node:crypto';

export function generateSessionId(): string {
	return crypto.randomUUID();
}

// Create a new session in the KV store
export async function createSession(data: any, kv: KVNamespace): Promise<string> {
	const sessionId = generateSessionId();
	try {
		await kv.put(sessionId, JSON.stringify(data), { expirationTtl: 60 * 60 * 1 });
	} catch (error) {
		console.error('Error creating session: ' + error);
	}
	return sessionId;
}

// Update session data in the KV store
export async function updateSession(sessionId: string, data: any, kv: KVNamespace): Promise<void> {
	await kv.put(sessionId, JSON.stringify(data), { expirationTtl: 60 * 60 * 1 });
}

// Add data to an existing session
export async function addToSession(sessionId: string, data: any, kv: KVNamespace): Promise<void> {
	const sessionData = await getSessionData(sessionId, kv);
	await updateSession(sessionId, { ...sessionData, ...data }, kv);
}

// Retrieve session data from the KV store
export async function getSessionData(sessionId: string, kv: KVNamespace): Promise<any> {
	if (!sessionId) return null;
	const data = await kv.get(sessionId);
	return data ? JSON.parse(data) : null;
}

// Delete a session from the KV store
export async function deleteSession(sessionId: string, kv: KVNamespace): Promise<void> {
	await kv.delete(sessionId);
}
