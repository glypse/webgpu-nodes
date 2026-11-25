import { describe, expect, it } from "bun:test";

import { TexturePool } from "./texture-pool";

class Fake {
	destroyed = false;
	destroy() {
		this.destroyed = true;
	}
}

const spec = (width: number, format = "rgba16float") => ({
	width,
	height: width,
	format,
	levels: 1,
});

function pool() {
	const made: Fake[] = [];
	return {
		made,
		pool: new TexturePool(() => {
			const texture = new Fake();
			made.push(texture);
			return texture;
		}),
	};
}

describe("TexturePool", () => {
	it("gives a released texture again for the same size and format only", () => {
		const { pool: p, made } = pool();
		const a = p.acquire(spec(4));
		p.release(a);
		expect(p.acquire(spec(4))).toBe(a);
		const b = p.acquire(spec(8));
		const c = p.acquire(spec(4, "rgba8unorm"));
		expect(new Set([a, b, c]).size).toBe(3);
		expect(made.length).toBe(3);
	});

	it("never gives a texture that's borrowed", () => {
		const { pool: p } = pool();
		expect(p.acquire(spec(4))).not.toBe(p.acquire(spec(4)));
	});

	it("makes no new textures once a frame's are kept, however often it's drawn", () => {
		const { pool: p, made } = pool();
		for (let frame = 0; frame < 10; frame++) {
			const kept = p.acquire(spec(4));
			for (let i = 0; i < 20; i++) {
				const next = p.acquire(spec(4 + (i % 3)));
				p.release(next);
			}
			p.release(kept);
			p.trim();
		}
		expect(made.length).toBeLessThanOrEqual(4);
		expect(p.borrowed).toBe(0);
		expect(p.size).toBeLessThanOrEqual(4);
	});

	it("destroys what an encode didn't use, but not what it did", () => {
		const { pool: p } = pool();
		const used = p.acquire(spec(4));
		const stale = p.acquire(spec(8));
		p.release(used);
		p.release(stale);
		p.trim();
		const again = p.acquire(spec(4));
		expect(again).toBe(used);
		p.release(again);
		p.trim();
		expect(used.destroyed).toBe(false);
		expect(stale.destroyed).toBe(true);
		expect(p.size).toBe(1);
	});

	it("refuses a texture released twice", () => {
		const { pool: p } = pool();
		const a = p.acquire(spec(4));
		p.release(a);
		expect(() => {
			p.release(a);
		}).toThrow();
	});
});
