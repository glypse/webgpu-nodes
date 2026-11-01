import { expect } from "bun:test";

/**
 * `expect.objectContaining`, typed as the value the assertion expects (taken
 * from it): bun types its asymmetric matchers as `any`.
 */
export function containing<T>(subset: NoInfer<Partial<T>>): T {
	return expect.objectContaining(subset) as T;
}
