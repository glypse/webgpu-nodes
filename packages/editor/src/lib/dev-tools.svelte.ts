import { createContext } from "svelte";

/**
 * Debugging aids (developer-tool nodes, shader logs, ids in the UI). The app
 * decides the initial state; the user can toggle it at any time.
 */
export class DevTools {
	enabled = $state(false);

	constructor(enabled = false) {
		this.enabled = enabled;
	}
}

export const [getDevTools, setDevTools] = createContext<DevTools>();
