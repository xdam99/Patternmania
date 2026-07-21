export const LANES = ["green", "red", "yellow", "blue", "orange"] as const;

export type Lane = (typeof LANES)[number];
export type ExportFormat = "visual" | "compact";

export interface PatternRow {
  id: string;
  open: boolean;
  lanes: Record<Lane, boolean>;
}

export interface PatternDocument {
  version: 1;
  title: string;
  rows: PatternRow[];
}
