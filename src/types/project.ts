export type ProjectEntry = {
  name: string;
  path: string;
  last_modified_secs?: number | null;
};

export type FileNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileNode[];
};
