/**
 * Restore the DOM behaviour DOMPurify relies on under happy-dom.
 *
 * DOMPurify reads node properties through getters cached off `Node.prototype`
 * (`nodeName`, and the accessors it uses while removing nodes). happy-dom defines
 * those accessors only on its internal element classes, so the cached reads come
 * back empty: every element resolves to an empty tag name and the sanitizer
 * miscarries. Its `NodeIterator.nextNode()` also returns null once a node has been
 * removed mid-walk, so the sanitizer stops after its first removal. A browser — the
 * production runtime — has neither defect.
 *
 * Call this once per test file that exercises the real sanitizer for real; without
 * it DOMPurify removes the wrong nodes and any assertion passes or fails by accident.
 * The returned function puts both globals back, so a suite that shares its process
 * with other files (the aggregate run) can exercise the sanitizer without leaving
 * its removal behaviour changed behind it.
 */
let installed = false;

/** Install the shims, returning the restore function that undoes them. */
export function installDompurifyShims(): () => void {
    if (installed) return () => {};
    installed = true;
    const nodeNameDescriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'nodeName');
    const originalCreateNodeIterator = document.createNodeIterator;
    if (nodeNameDescriptor?.get) {
        const originalNodeNameGet = nodeNameDescriptor.get;
        Object.defineProperty(Node.prototype, 'nodeName', {
            configurable: true,
            get(this: Node): string {
                let proto: object | null = Object.getPrototypeOf(this);
                while (proto && proto !== Node.prototype) {
                    const descriptor = Object.getOwnPropertyDescriptor(proto, 'nodeName');
                    if (descriptor?.get) return descriptor.get.call(this) as string;
                    proto = Object.getPrototypeOf(proto);
                }
                return originalNodeNameGet.call(this) as string;
            },
        });
    }

    const nodeMaskBit = (node: Node): number => 1 << (node.nodeType - 1);
    const collectNodes = (root: Node, whatToShow: number): Node[] => {
        const collected: Node[] = [];
        const visit = (node: Node): void => {
            if (whatToShow & nodeMaskBit(node)) collected.push(node);
            for (const child of Array.from(node.childNodes)) if (child) visit(child);
        };
        visit(root);
        return collected;
    };
    document.createNodeIterator = ((root: Node, whatToShow = 0xffffffff) => {
        const nodes = collectNodes(root, whatToShow);
        let index = 0;
        return {
            root,
            referenceNode: root,
            nextNode(): Node | null {
                while (index < nodes.length) {
                    const node = nodes[index++];
                    if (node && (node === root || (root as ParentNode).contains(node))) return node;
                }
                return null;
            },
            previousNode: (): Node | null => null,
        };
    }) as unknown as Document['createNodeIterator'];

    return () => {
        installed = false;
        if (nodeNameDescriptor) Object.defineProperty(Node.prototype, 'nodeName', nodeNameDescriptor);
        document.createNodeIterator = originalCreateNodeIterator;
    };
}
