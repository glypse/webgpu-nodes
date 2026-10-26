import { getContext, setContext } from "svelte";

import type { ToggleVariants } from "../toggle/variants.js";

type ToggleGroupContext = ToggleVariants & {
	spacing?: number;
	orientation?: "horizontal" | "vertical";
};

export function setToggleGroupCtx(props: ToggleGroupContext) {
	setContext("toggleGroup", props);
}

export function getToggleGroupCtx() {
	return getContext<ToggleGroupContext>("toggleGroup");
}
