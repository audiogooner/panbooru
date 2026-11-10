import { browser } from '$app/env';
import { SvelteSet } from 'svelte/reactivity';
import {
	SHARED_WORKSPACE_KEY,
	WORKSPACE_KEY,
	adoptSharedWorkspace,
	readSharedWorkspace,
	writeSharedWorkspace,
	type WorkspaceCheckpoint,
	type WorkspaceStore
} from '#lib/workspace.ts';

let memory: WorkspaceCheckpoint | null = null;
let seenAt = 0;
let notifying = false;
let listening = false;

const replacedListeners = new SvelteSet<(checkpoint: WorkspaceCheckpoint | null) => void>();

/** Store view of the shared checkpoint. Remote updates do not write back. */
export function workspaceBacking(): WorkspaceStore {
	return {
		getItem(key) {
			if (key !== WORKSPACE_KEY) return null;
			return memory ? JSON.stringify(memory) : null;
		},
		setItem(_key, value) {
			if (notifying) return;
			let parsed: WorkspaceCheckpoint;
			try {
				parsed = JSON.parse(value) as WorkspaceCheckpoint;
			} catch {
				return;
			}
			memory = parsed;
			const updatedAt = Math.max(Date.now(), seenAt + 1);
			try {
				const saved = writeSharedWorkspace(localStorage, parsed, updatedAt);
				if (saved.persisted) seenAt = saved.shared.updatedAt;
			} catch {
				// The checkpoint stays in memory for this tab.
			}
		}
	};
}

/** Load the searches shared by every tab in this browser. */
export function bootWorkspace(): WorkspaceCheckpoint | null {
	if (!browser) return null;
	try {
		bindStorage();
		const shared = adoptSharedWorkspace(localStorage, sessionStorage, Date.now());
		if (!shared) return null;
		memory = shared.checkpoint;
		seenAt = shared.updatedAt;
		return shared.checkpoint.views.length > 0 ? shared.checkpoint : null;
	} catch {
		return null;
	}
}

export function onWorkspaceReplaced(listener: (checkpoint: WorkspaceCheckpoint | null) => void) {
	replacedListeners.add(listener);
	return () => {
		replacedListeners.delete(listener);
	};
}

function bindStorage() {
	if (listening) return;
	listening = true;
	window.addEventListener('storage', (event) => {
		if (event.key !== SHARED_WORKSPACE_KEY || !event.newValue) return;
		let shared;
		try {
			shared = readSharedWorkspace({
				getItem: (key) => (key === SHARED_WORKSPACE_KEY ? event.newValue : null),
				setItem() {
					// The storage event is already the written record.
				}
			});
		} catch {
			return;
		}
		if (!shared) return;
		if (shared.updatedAt < seenAt) return;
		if (
			shared.updatedAt === seenAt &&
			JSON.stringify(shared.checkpoint) === JSON.stringify(memory)
		) {
			return;
		}
		seenAt = shared.updatedAt;
		memory = shared.checkpoint;
		notifying = true;
		try {
			for (const listener of replacedListeners) listener(shared.checkpoint);
		} finally {
			notifying = false;
		}
	});
}
