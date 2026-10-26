import type { InputControl, InputValue, WgslType } from "$core";

/** What every input control editor receives. */
export type ControlProps<C extends InputControl = InputControl> = {
	control: C;
	/** The input's resolved type. */
	type: WgslType;
	value: InputValue | undefined;
	disabled: boolean;
	/** Unique to the input, for form elements. */
	name: string;
	onchange: (value: InputValue) => void;
};
