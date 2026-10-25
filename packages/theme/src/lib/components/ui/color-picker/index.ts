import Root from "./color-picker.svelte";
import Wheel from "./color-wheel.svelte";
import Wheels from "./color-wheels.svelte";
import OklchLightness from "./oklch-lightness.svelte";
import OklchWheel, { OKLCH_MAX_CHROMA } from "./oklch-wheel.svelte";
import ValueRamp from "./value-ramp.svelte";

export {
	Root,
	Wheel,
	Wheels,
	ValueRamp,
	OklchWheel,
	OklchLightness,
	OKLCH_MAX_CHROMA,
	//
	Root as ColorPicker,
	Wheel as ColorWheel,
	Wheels as ColorWheels,
	ValueRamp as ColorValueRamp,
};
