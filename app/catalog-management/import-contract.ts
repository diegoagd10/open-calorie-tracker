import type { CatalogImportJob, InstalledCatalog } from "./catalog-management.server.ts";

export type ImportOptions = { archivePath: string; directory: string; generation: string; maxExpandedBytes: number; maxDatabaseBytes?: number; maxDocumentBytes?: number };
export type ImportMessage = {
  progress?: Partial<CatalogImportJob>;
  result?: Pick<InstalledCatalog, "foodCount" | "publicationDateRange" | "sourceDateRange" | "archiveFormat" | "expandedBytes">;
  error?: string;
};
