/**
 * Visits what `root` depends on before `root`'s dependents need it, without
 * recursing: `visit` gets every node `done` doesn't hold yet, each after the
 * ones it depends on, so a memoised recursive computation then started on
 * `root` finds its dependencies known and stays shallow however long the
 * chain of links behind it. `root` itself isn't visited.
 */
export function visitUpstream<T>(
	root: T,
	dependencies: (node: T) => Iterable<T>,
	done: (node: T) => boolean,
	visit: (node: T) => void,
): void {
	const seen = new Set<T>([root]);
	const stack: { node: T; next: Iterator<T> }[] = [
		{ node: root, next: dependencies(root)[Symbol.iterator]() },
	];
	for (let top = stack.at(-1); top; top = stack.at(-1)) {
		const step = top.next.next();
		if (step.done) {
			stack.pop();
			if (stack.length > 0) visit(top.node);
			continue;
		}
		const dependency = step.value;
		if (seen.has(dependency) || done(dependency)) continue;
		seen.add(dependency);
		stack.push({ node: dependency, next: dependencies(dependency)[Symbol.iterator]() });
	}
}
