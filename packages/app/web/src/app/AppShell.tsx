import { useEffect, useRef, useState } from "react";
import { Outlet } from "react-router";
import { toast } from "sonner";
import { api, type Me } from "@/lib/api";
import { useReportLocation } from "@/lib/presence";
import { awareness, colorFor, seedIfEmpty, signals, whenSynced } from "@/lib/yjs";
import { MeContext } from "./context";
import { Sidebar } from "./Sidebar";
import { StatusBanners } from "./StatusBanners";
import { useNavigate } from "react-router";

/** Loads identity and the shared document once, then renders the sidebar and the current page. */
export function AppShell() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [synced, setSynced] = useState(false);
  const navigate = useNavigate();
  useReportLocation();

  useEffect(() => {
    api<Me>("/me").then(
      (m) => (typeof m === "object" && m?.email ? setMe(m) : setError("The API did not answer. Open the workbench through Caddy at http://localhost:8080.")),
      (e) => setError(e.message),
    );
    whenSynced.then(() => {
      seedIfEmpty();
      setSynced(true);
    });
  }, []);

  useEffect(() => {
    if (me) awareness.setLocalStateField("user", { email: me.email, name: me.name, color: colorFor(me.email), role: me.role });
  }, [me]);

  // Toast new requests in groups whose notify list includes me.
  const lastN = useRef<number | null>(null);
  useEffect(() => {
    if (!me) return;
    lastN.current = signals.get("requests")?.n ?? 0;
    const h = () => {
      const s = signals.get("requests");
      if (!s) return;
      if (lastN.current !== null && s.n > lastN.current && s.detail?.title && (s.detail.notify ?? []).includes(me.email)) {
        const id = s.detail.id;
        toast(`New request: ${s.detail.title}`, { description: `in ${s.detail.group}`, action: { label: "Open", onClick: () => navigate(`/requests/${id}`) } });
      }
      lastN.current = s.n;
    };
    signals.observe(h);
    return () => signals.unobserve(h);
  }, [me, navigate]);

  if (error) return <div className="p-8 text-sm text-status-critical-ink">Could not load the workbench: {error}</div>;
  if (!me || !synced) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Connecting…</div>;

  return (
    <MeContext.Provider value={me}>
      <div className="flex h-full bg-background text-foreground">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <StatusBanners />
          <Outlet />
        </main>
      </div>
    </MeContext.Provider>
  );
}
