import { browser } from '$app/env';
import { SvelteSet } from 'svelte/reactivity';
import {
	LEASE_HEARTBEAT_MS,
	WORKSPACE_HELLO_MS,
	WORKSPACE_KEY,
	chooseWorkspace,
	heartbeatLease,
	holdLease,
	importLegacyCheckpoint,
	leaseIsLive,
	noteWorkspace,
	readCatalog,
	saveWorkspaceRecord,
	readCheckpoint,
	readLeases,
	readSessionIdentity,
	releaseLease,
	writeLeases,
	writeSessionIdentity,
	type WorkspaceCheckpoint,
	type WorkspaceClaim,
	type WorkspaceStore
} from '#lib/workspace.ts';

const CHANNEL = 'panbooru-workspace';
/** Latest checkpoint for this tab. Survives a reload that happens before the catalog write. */
const PENDING_KEY = 'panbooru-workspace-pending';

export type WorkspaceSettle = {
	replaced: boolean;
	checkpoint: WorkspaceCheckpoint | null;
};

let tabId: string | null = null;
let workspaceId: string | null = null;
let writesOpen = false;
let awaitingHello = false;
let memory: WorkspaceCheckpoint | null = null;
let pendingWrite: string | null = null;
let touchedAt = 0;
let channel: BroadcastChannel | null = null;
let heartbeatTimer = 0;
let listenersBound = false;
let settling: Promise<WorkspaceSettle> | null = null;
let replaceGeneration = 0;

const replacedListeners = new SvelteSet<(checkpoint: WorkspaceCheckpoint | null) => void>();

let contest: {
	asked: string;
	timer: number;
	busy: boolean;
	left: boolean;
} | null = null;

/** Store view of this tab's checkpoint. Writes wait until the tab id is confirmed. */
export function workspaceBacking(): WorkspaceStore {
	return {
		getItem(key) {
			if (key !== WORKSPACE_KEY) return null;
			if (pendingWrite !== null) return pendingWrite;
			return memory ? JSON.stringify(memory) : null;
		},
		setItem(_key, value) {
			pendingWrite = value;
			try {
				sessionStorage.setItem(PENDING_KEY, value);
			} catch {
				// The in-memory copy still flushes when this tab is confirmed.
			}
			if (!writesOpen) return;
			flushPending();
		}
	};
}

/**
 * Load this tab's workspace. A reload keeps its record. A new tab adopts the newest free one.
 * A copied tab id stays read-only until {@link settleWorkspace} confirms it is alone.
 */
export function bootWorkspace(): WorkspaceCheckpoint | null {
	if (!browser) return null;
	try {
		bindListeners();
		let catalog = readCatalog(localStorage);
		const legacy = readCheckpoint(sessionStorage);
		if (catalog.workspaces.length === 0 && legacy && legacy.views.length > 0) {
			const importedId = crypto.randomUUID();
			const imported = importLegacyCheckpoint(catalog, legacy, Date.now(), importedId);
			const importedRecord = imported?.workspaces[0];
			if (importedRecord) {
				const saved = saveWorkspaceRecord(
					localStorage,
					readLeases(localStorage),
					importedRecord,
					importedRecord.updatedAt
				);
				if (saved.persisted) {
					catalog = saved.catalog;
					sessionStorage.removeItem(WORKSPACE_KEY);
					const session = readSessionIdentity(sessionStorage);
					writeSessionIdentity(sessionStorage, {
						tabId: session.tabId ?? crypto.randomUUID(),
						workspaceId: importedId
					});
				}
			}
		}
		const session = readSessionIdentity(sessionStorage);
		const leases = readLeases(localStorage);
		if (session.tabId && session.workspaceId) {
			tabId = session.tabId;
			workspaceId = session.workspaceId;
			awaitingHello = true;
			writesOpen = false;
			ensureChannel();
			const held = holdLease(leases, session.workspaceId, session.tabId, Date.now());
			if (held.held) writeOwnLease(false);
			const record = catalog.workspaces.find((item) => item.id === session.workspaceId);
			const pendingCheckpoint = held.held ? readPendingCheckpoint() : null;
			const chosen = pendingCheckpoint ?? record?.checkpoint ?? null;
			if (chosen && held.held) {
				memory = chosen;
				touchedAt = record?.updatedAt ?? Date.now();
				if (pendingCheckpoint) pendingWrite = sessionStorage.getItem(PENDING_KEY);
				return chosen.views.length > 0 ? chosen : null;
			}
			memory = null;
			return null;
		}
		const decision = chooseWorkspace({
			session,
			catalog,
			leases,
			now: Date.now(),
			contested: false,
			nextTabId: crypto.randomUUID(),
			nextWorkspaceId: crypto.randomUUID()
		});
		if (!commitClaim(decision)) {
			const retry = chooseWorkspace({
				session: { tabId: decision.tabId, workspaceId: null },
				catalog: readCatalog(localStorage),
				leases: readLeases(localStorage),
				now: Date.now(),
				contested: true,
				nextTabId: decision.tabId,
				nextWorkspaceId: crypto.randomUUID()
			});
			commitClaim(retry);
		}
		awaitingHello = false;
		writesOpen = true;
		ensureChannel();
		startHeartbeat();
		return memory;
	} catch {
		return null;
	}
}

/** Confirm a copied tab id. A contested id adopts a different free workspace before any write. */
export function settleWorkspace(): Promise<WorkspaceSettle> {
	if (!browser || !awaitingHello || !tabId) {
		return Promise.resolve({ replaced: false, checkpoint: memory });
	}
	if (settling) return settling;
	const asked = tabId;
	const previousId = workspaceId;
	settling = hearContest(asked).then((contested) => {
		awaitingHello = false;
		const decision = chooseWorkspace({
			session: { tabId: asked, workspaceId: previousId },
			catalog: readCatalog(localStorage),
			leases: readLeases(localStorage),
			now: Date.now(),
			contested,
			nextTabId: crypto.randomUUID(),
			nextWorkspaceId: crypto.randomUUID()
		});
		let claim = decision;
		if (!commitClaim(claim)) {
			claim = chooseWorkspace({
				session: { tabId: decision.tabId, workspaceId: null },
				catalog: readCatalog(localStorage),
				leases: readLeases(localStorage),
				now: Date.now(),
				contested: true,
				nextTabId: decision.tabId,
				nextWorkspaceId: crypto.randomUUID()
			});
			commitClaim(claim);
		}
		const replaced = claim.workspaceId !== previousId;
		if (replaced) publishReplacement(claim.checkpoint);
		else {
			writesOpen = true;
			flushPending();
		}
		startHeartbeat();
		return { replaced, checkpoint: claim.checkpoint };
	});
	return settling;
}

export function onWorkspaceReplaced(listener: (checkpoint: WorkspaceCheckpoint | null) => void) {
	replacedListeners.add(listener);
	if (replaceGeneration > 0) listener(memory);
	return () => {
		replacedListeners.delete(listener);
	};
}

function publishReplacement(checkpoint: WorkspaceCheckpoint | null) {
	pendingWrite = null;
	try {
		sessionStorage.removeItem(PENDING_KEY);
	} catch {
		// The next flush writes the replacement, not the copied checkpoint.
	}
	memory = checkpoint;
	writesOpen = true;
	replaceGeneration += 1;
	for (const listener of replacedListeners) listener(checkpoint);
}

function commitClaim(decision: WorkspaceClaim) {
	tabId = decision.tabId;
	workspaceId = decision.workspaceId;
	const record = decision.catalog.workspaces.find((item) => item.id === decision.workspaceId);
	memory = decision.created ? null : (record?.checkpoint ?? decision.checkpoint);
	try {
		writeSessionIdentity(sessionStorage, {
			tabId: decision.tabId,
			workspaceId: decision.workspaceId
		});
		const now = Date.now();
		const checkpoint = record?.checkpoint ?? decision.checkpoint;
		if (checkpoint) {
			const saved = saveWorkspaceRecord(
				localStorage,
				readLeases(localStorage),
				{ id: decision.workspaceId, updatedAt: now, checkpoint },
				now
			);
			if (saved.persisted) touchedAt = now;
		}
		return writeOwnLease(false);
	} catch {
		return false;
	}
}

function flushPending(force = false) {
	if (!browser || !workspaceId || pendingWrite === null) return;
	if (!writesOpen && !force) return;
	let parsed: WorkspaceCheckpoint;
	try {
		parsed = JSON.parse(pendingWrite) as WorkspaceCheckpoint;
	} catch {
		return;
	}
	memory = parsed;
	pendingWrite = null;
	const id = workspaceId;
	const now = Date.now();
	try {
		const saved = saveWorkspaceRecord(
			localStorage,
			readLeases(localStorage),
			{ id, updatedAt: now, checkpoint: parsed },
			now
		);
		if (saved.persisted) {
			touchedAt = now;
			sessionStorage.removeItem(PENDING_KEY);
		}
		writeOwnLease(false);
	} catch {
		// The checkpoint stays in memory for this tab.
	}
}

function readPendingCheckpoint() {
	try {
		return readCheckpoint({
			getItem: (key) => (key === WORKSPACE_KEY ? sessionStorage.getItem(PENDING_KEY) : null),
			setItem() {
				// Pending is written by the workspace store, not by this read.
			}
		});
	} catch {
		return null;
	}
}

function writeOwnLease(released: boolean) {
	if (!tabId || !workspaceId) return false;
	const id = workspaceId;
	const owner = tabId;
	const now = Date.now();
	for (let attempt = 0; attempt < 3; attempt++) {
		const current = readLeases(localStorage);
		const existing = current.leases.find((lease) => lease.workspaceId === id);
		if (!released && existing && leaseIsLive(existing, now) && existing.tabId !== owner)
			return false;
		const next = released
			? releaseLease(current, id, owner, now)
			: heartbeatLease(current, id, owner, now);
		writeLeases(localStorage, next);
		const mine = readLeases(localStorage).leases.find((lease) => lease.workspaceId === id);
		if (released) {
			if (!mine || mine.tabId !== owner || mine.released) return true;
		} else if (mine?.tabId === owner && !mine.released) {
			return true;
		}
	}
	return false;
}

function hearContest(asked: string) {
	return new Promise<boolean>((resolve) => {
		const active = ensureChannel();
		if (!active) {
			resolve(false);
			return;
		}
		const timer = window.setTimeout(() => {
			const pending = contest;
			contest = null;
			resolve(!!pending && pending.asked === asked && pending.busy && !pending.left);
		}, WORKSPACE_HELLO_MS);
		contest = { asked, timer, busy: false, left: false };
		active.postMessage({ type: 'hello', tabId: asked });
	});
}

function ensureChannel() {
	if (channel) return channel;
	try {
		channel = new BroadcastChannel(CHANNEL);
	} catch {
		return null;
	}
	channel.onmessage = (event: MessageEvent) => {
		const data = event.data as { type?: unknown; tabId?: unknown } | null;
		if (!data || typeof data.type !== 'string' || typeof data.tabId !== 'string') return;
		if (data.type === 'hello' && data.tabId === tabId && tabId) {
			channel?.postMessage({ type: 'busy', tabId });
		}
		if (data.type === 'busy' && contest && data.tabId === contest.asked) contest.busy = true;
		if (data.type === 'bye' && contest && data.tabId === contest.asked) contest.left = true;
	};
	return channel;
}

function startHeartbeat() {
	if (!browser || heartbeatTimer) return;
	heartbeatTimer = window.setInterval(() => {
		if (!writesOpen || awaitingHello) return;
		try {
			writeOwnLease(false);
			if (workspaceId && touchedAt) noteWorkspace(localStorage, workspaceId, touchedAt);
		} catch {
			// The next beat tries again.
		}
	}, LEASE_HEARTBEAT_MS);
}

function bindListeners() {
	if (listenersBound) return;
	listenersBound = true;
	window.addEventListener('pagehide', () => {
		if (heartbeatTimer) {
			window.clearInterval(heartbeatTimer);
			heartbeatTimer = 0;
		}
		const liveDuplicate = !!contest?.busy && !contest.left;
		if (contest) {
			window.clearTimeout(contest.timer);
			contest = null;
		}
		try {
			if (tabId) channel?.postMessage({ type: 'bye', tabId });
		} catch {
			// The next document can still reclaim this tab id from sessionStorage.
		}
		channel?.close();
		channel = null;
		if (liveDuplicate) return;
		try {
			if (!pendingWrite) {
				const raw = sessionStorage.getItem(PENDING_KEY);
				if (raw) pendingWrite = raw;
			}
			flushPending(true);
			if (workspaceId && touchedAt) noteWorkspace(localStorage, workspaceId, touchedAt);
			writeOwnLease(true);
		} catch {
			// The catalog still has the checkpoint.
		}
	});
	window.addEventListener('pageshow', (event) => {
		if (!tabId || !workspaceId || awaitingHello) return;
		try {
			const held = holdLease(readLeases(localStorage), workspaceId, tabId, Date.now());
			if (held.held) {
				writeOwnLease(false);
				ensureChannel();
				startHeartbeat();
				return;
			}
			if (!event.persisted) return;
			const previous = workspaceId;
			const decision = chooseWorkspace({
				session: { tabId, workspaceId: null },
				catalog: readCatalog(localStorage),
				leases: readLeases(localStorage),
				now: Date.now(),
				contested: true,
				nextTabId: tabId,
				nextWorkspaceId: crypto.randomUUID()
			});
			commitClaim(decision);
			writesOpen = true;
			startHeartbeat();
			if (decision.workspaceId !== previous) publishReplacement(decision.checkpoint);
		} catch {
			// Keep the in-memory checkpoint.
		}
	});
}
