/**
 * Linear undo/redo history of opaque states (project content snapshots).
 *
 * `record` pushes a new state (dropping the redo branch); recording the
 * current state again is a no-op, so callers can record eagerly. Only the
 * stack sizes are reactive, for enabling Undo/Redo menu items.
 */
export class History {
	private past: string[] = [];
	private future: string[] = [];
	private current: string | undefined;

	undoCount = $state(0);
	redoCount = $state(0);

	constructor(private limit = 200) {}

	get canUndo(): boolean {
		return this.undoCount > 0;
	}

	get canRedo(): boolean {
		return this.redoCount > 0;
	}

	/** Forget everything and start from `state`. */
	reset(state: string) {
		this.past = [];
		this.future = [];
		this.current = state;
		this.sync();
	}

	/** Record `state` as the newest step. Returns false when it equals the current state. */
	record(state: string): boolean {
		if (state === this.current) return false;
		if (this.current !== undefined) {
			this.past.push(this.current);
			if (this.past.length > this.limit) this.past.shift();
		}
		this.current = state;
		this.future = [];
		this.sync();
		return true;
	}

	/**
	 * Replace the current state without adding a step (e.g. with the
	 * normalised form of a state that was just restored).
	 */
	replaceCurrent(state: string) {
		this.current = state;
	}

	/** Step back; returns the state to restore, if any. */
	undo(): string | undefined {
		const previous = this.past.pop();
		if (previous === undefined || this.current === undefined) return undefined;
		this.future.push(this.current);
		this.current = previous;
		this.sync();
		return previous;
	}

	/** Step forward; returns the state to restore, if any. */
	redo(): string | undefined {
		const next = this.future.pop();
		if (next === undefined || this.current === undefined) return undefined;
		this.past.push(this.current);
		this.current = next;
		this.sync();
		return next;
	}

	private sync() {
		this.undoCount = this.past.length;
		this.redoCount = this.future.length;
	}
}
