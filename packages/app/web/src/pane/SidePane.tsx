import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSidePane } from "@/app/context";
import { RunPane } from "./RunPane";
import { RequestPane } from "./RequestPane";
import { ServicePane } from "./ServicePane";

export function SidePane() {
  const { kind, id, close } = useSidePane();
  return (
    <aside className="relative flex h-full flex-col border-l bg-background" data-testid="side-pane">
      <Button variant="ghost" size="icon" className="absolute right-2 top-2 z-10 size-7" onClick={close} aria-label="Close pane">
        <X className="size-4" />
      </Button>
      {kind === "run" && id && <RunPane id={Number(id)} key={id} />}
      {kind === "request" && id && <RequestPane id={Number(id)} key={id} />}
      {kind === "service" && id && <ServicePane id={id} key={id} />}
    </aside>
  );
}
