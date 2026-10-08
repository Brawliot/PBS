/**
 * Strongly connected components of a directed graph (Tarjan, written without recursion so a long chain of
 * steps cannot overflow the stack). Two nodes are in the same component when each one can reach the other.
 */

/** The component number of each node in `nodes`. Edges with an end outside `nodes` are ignored. */
export function componentsOf(nodes: readonly string[], edges: readonly (readonly [string, string])[]): Map<string, number> {
  const known = new Set(nodes);
  const next = new Map<string, string[]>();
  for (const [from, to] of edges) {
    if (known.has(from) && known.has(to)) next.set(from, [...(next.get(from) ?? []), to]);
  }

  const order = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const component = new Map<string, number>();
  let counter = 0;
  let components = 0;

  const enter = (node: string) => {
    order.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);
  };

  for (const root of nodes) {
    if (order.has(root)) continue;
    enter(root);
    // Each frame: the node and how many of its targets are already visited
    const frames: { node: string; child: number }[] = [{ node: root, child: 0 }];
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const targets = next.get(frame.node) ?? [];
      if (frame.child < targets.length) {
        const target = targets[frame.child];
        frame.child += 1;
        if (!order.has(target)) {
          enter(target);
          frames.push({ node: target, child: 0 });
        } else if (onStack.has(target)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, order.get(target)!));
        }
        continue;
      }
      frames.pop();
      if (frames.length > 0) {
        const parent = frames[frames.length - 1].node;
        low.set(parent, Math.min(low.get(parent)!, low.get(frame.node)!));
      }
      if (low.get(frame.node) === order.get(frame.node)) {
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          component.set(member, components);
        } while (member !== frame.node);
        components += 1;
      }
    }
  }
  return component;
}
