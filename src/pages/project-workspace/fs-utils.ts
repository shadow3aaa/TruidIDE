import type { FileNode } from "@/types/project";

import type { ColumnState } from "./types";

export const normalizeFsPath = (value: string): string => {
  if (!value) {
    return "";
  }
  const withoutUnc = value.startsWith("\\\\?\\") ? value.slice(4) : value;
  const normalizedSlashes = withoutUnc.replace(/\\/g, "/");
  return normalizedSlashes.replace(/\/+$/, "");
};

export const getDisplayPath = (directoryPath: string, projectPath: string): string => {
  const current = normalizeFsPath(directoryPath);
  const project = normalizeFsPath(projectPath);

  if (current.toLowerCase() === project.toLowerCase()) {
    return "./";
  }

  if (current.toLowerCase().startsWith(project.toLowerCase())) {
    const relative = current.slice(project.length).replace(/^\/+/, "");
    return relative.length ? `./${relative}` : "./";
  }

  return current || "./";
};

export const normalizeForCompare = (value: string): string => normalizeFsPath(value).toLowerCase();

export const createColumnState = (directoryPath: string): ColumnState => ({
  directoryPath,
  stack: [],
  lastVisitedChildPath: null,
  lastVisitedChildParentPath: null,
});

export const cloneColumnState = (state: ColumnState): ColumnState => ({
  directoryPath: state.directoryPath,
  stack: [...state.stack],
  lastVisitedChildPath: state.lastVisitedChildPath,
  lastVisitedChildParentPath: state.lastVisitedChildParentPath,
});

export const getParentDirectoryPath = (path: string): string => {
  if (!path) {
    return "";
  }
  const trimmed = path.replace(/[\\/]+$/, "");
  const lastBackslash = trimmed.lastIndexOf("\\");
  const lastSlash = trimmed.lastIndexOf("/");
  const index = Math.max(lastBackslash, lastSlash);
  if (index === -1) {
    return "";
  }
  return trimmed.slice(0, index);
};

export const joinFsPath = (directoryPath: string, childName: string): string => {
  if (!directoryPath) {
    return childName;
  }
  const lastChar = directoryPath.charAt(directoryPath.length - 1);
  if (lastChar === "/" || lastChar === "\\") {
    return `${directoryPath}${childName}`;
  }
  const separator = directoryPath.includes("\\") && !directoryPath.includes("/") ? "\\" : "/";
  return `${directoryPath}${separator}${childName}`;
};

export const isPathWithin = (path: string, directoryPath: string): boolean => {
  if (!path || !directoryPath) {
    return false;
  }
  const target = normalizeForCompare(path);
  const parent = normalizeForCompare(directoryPath);
  if (!target || !parent) {
    return false;
  }
  if (target === parent) {
    return true;
  }
  return target.startsWith(`${parent}/`);
};

const sortNodesByName = (nodes: FileNode[]): FileNode[] => {
  return [...nodes].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
};

export const findFolderNode = (nodes: FileNode[], targetPath: string): FileNode | null => {
  const targetNormalized = normalizeForCompare(targetPath);

  const walk = (list: FileNode[]): FileNode | null => {
    for (const node of list) {
      if (node.type !== "folder") {
        continue;
      }
      if (normalizeForCompare(node.path) === targetNormalized) {
        return node;
      }
      if (node.children?.length) {
        const match = walk(node.children);
        if (match) {
          return match;
        }
      }
    }
    return null;
  };

  return walk(nodes);
};

export const getDirectoryEntries = (tree: FileNode[], directoryPath: string, projectPath: string): FileNode[] => {
  if (!tree.length) {
    return [];
  }

  const projectNormalized = normalizeForCompare(projectPath);
  const directoryNormalized = normalizeForCompare(directoryPath);

  if (directoryNormalized === projectNormalized) {
    return sortNodesByName(tree);
  }

  const folderNode = findFolderNode(tree, directoryPath);
  if (!folderNode?.children?.length) {
    return [];
  }

  return sortNodesByName(folderNode.children);
};
