import type { ReactNode } from "react";
import { useCan, type Role } from "@/app/context";

/**
 * Disables every control inside when the person's role is below `need` (a disabled fieldset turns
 * off all buttons and inputs in it at once). The server refuses the calls anyway; this keeps the UI honest.
 */
export function Gate({ need, children }: { need: Role; children: ReactNode }) {
  const ok = useCan(need);
  return (
    <fieldset disabled={!ok} className="contents" data-gate={need} data-allowed={ok}>
      {children}
    </fieldset>
  );
}
