import type { Root, RootContent } from 'mdast';
import type { TAttachment } from 'librechat-data-provider';

const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** Match a real output identity, never a filename on an arbitrary website. */
export function matchesFileOutput(href: string, outputs: TAttachment[]) {
  const target = decode(href).trim();
  return outputs.some((file) => {
    if (file.filepath && target === decode(file.filepath)) return true;
    if (/^(?:sandbox:|file:\/\/)?\/mnt\/data\//.test(target)) {
      return target.replace(/^(?:sandbox:|file:\/\/)?\/mnt\/data\//, '') === file.filename;
    }
    // Internal links may be relative or absolute; external names alone never match.
    try {
      const url = new URL(href, window.location.origin);
      const outputUrl = file.filepath ? new URL(file.filepath, window.location.origin) : undefined;
      if (
        outputUrl &&
        url.origin === outputUrl.origin &&
        url.pathname === outputUrl.pathname &&
        url.search === outputUrl.search
      )
        return true;
      if (url.origin !== window.location.origin) return false;
      const id = 'file_id' in file ? file.file_id : undefined;
      return Boolean(
        id &&
          /^\/(?:api\/)?(?:files|outputs)\//.test(url.pathname) &&
          (decode(url.pathname).split('/').includes(id) || url.searchParams.get('file_id') === id),
      );
    } catch {
      return false;
    }
  });
}

/** Remove only duplicate download links from the Markdown AST, leaving code intact. */
export default function remarkFileOutputs(outputs: TAttachment[]) {
  return (tree: Root) => {
    const definitions = new Map<string, string>();
    for (const node of tree.children) {
      if (node.type === 'definition') definitions.set(node.identifier, node.url);
    }
    let removedLinks = 0;
    const clean = (nodes: RootContent[]): RootContent[] =>
      nodes.flatMap((node) => {
        let href: string | undefined;
        if (node.type === 'link') href = node.url;
        if (node.type === 'linkReference') href = definitions.get(node.identifier);
        if (href && matchesFileOutput(href, outputs)) {
          removedLinks += 1;
          return [];
        }
        if ('children' in node) {
          // All MDAST parent children are traversed, including nested lists/emphasis.
          const removedBefore = removedLinks;
          node.children = clean(node.children as RootContent[]) as typeof node.children;
          if (
            node.type === 'paragraph' &&
            removedLinks > removedBefore &&
            node.children.every(
              (child) =>
                child.type === 'text' && /^(?:\s|📥|📎|📄|⬇️|[:：—-])*$/u.test(child.value),
            )
          )
            return [];
          if (
            [
              'paragraph',
              'strong',
              'emphasis',
              'delete',
              'listItem',
              'list',
              'blockquote',
            ].includes(node.type) &&
            (node.children.length === 0 ||
              node.children.every((child) => child.type === 'text' && !child.value.trim()))
          )
            return [];
        }
        return [node];
      });
    tree.children = clean(tree.children);
  };
}
