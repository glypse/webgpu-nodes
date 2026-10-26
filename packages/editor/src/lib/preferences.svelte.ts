import { setMode, userPrefersMode } from "mode-watcher";
import { createContext } from "svelte";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "webgpu-nodes:preferences";

/** The CSS variable the interface font is read from. */
const FONT_VARIABLE = "--font-interface";

function loadFont(): string {
	try {
		const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as unknown;
		if (typeof stored === "object" && stored !== null && "font" in stored) {
			return typeof stored.font === "string" ? stored.font : "";
		}
	} catch {
		// Unreadable storage (private mode, corrupt value): use the defaults.
	}
	return "";
}

/**
 * The user's own settings, kept in this browser rather than in projects.
 * The theme is mode-watcher's, which stores it itself.
 */
export class Preferences {
	#font = $state(loadFont());

	constructor() {
		this.applyFont();
	}

	get theme(): Theme {
		return userPrefersMode.current;
	}

	set theme(value: Theme) {
		setMode(value);
	}

	/** A CSS `font-family` list for the interface; empty for the default. */
	get font(): string {
		return this.#font;
	}

	set font(value: string) {
		this.#font = value.trim();
		this.applyFont();
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify({ font: this.#font }));
		} catch {
			// Not persisted, but still applied for this session.
		}
	}

	private applyFont() {
		const style = document.documentElement.style;
		if (this.#font) style.setProperty(FONT_VARIABLE, `${this.#font}, sans-serif`);
		else style.removeProperty(FONT_VARIABLE);
	}
}

export const [getPreferences, setPreferences] = createContext<Preferences>();
