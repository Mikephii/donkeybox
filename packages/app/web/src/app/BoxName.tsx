import { useApi } from "@/lib/hooks";

/** The box's name from Settings, for the sidebar and page titles. */
export function useBoxName(): string {
  const meta = useApi<{ box?: { name?: string } }>("/meta", ["config"], 60_000).data;
  return meta?.box?.name || "Workbench";
}
