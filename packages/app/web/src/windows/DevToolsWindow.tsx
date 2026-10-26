import type { WindowProps } from "./registry";

export function DevToolsWindow(_: WindowProps) {
  return (
    <div className="flex h-full flex-col">
      <p className="border-b px-3 py-1.5 text-[11px] text-muted-foreground">
        Chrome remote debugging on the VM (port 9222), for a headless browser an agent drives. Start Chrome with
        <code className="mx-1 rounded bg-muted px-1">--remote-debugging-port=9222</code>to use it.
      </p>
      <iframe src="/devtools/" title="devtools" className="min-h-0 w-full flex-1 border-0" />
    </div>
  );
}
