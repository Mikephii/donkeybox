import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate } from "react-router";
import { RouterProvider } from "react-router/dom";
import "./index.css";
import { initIdentityOverride } from "./lib/api";
import { ThemeProvider } from "./lib/theme";
import { AppShell } from "./app/AppShell";
import { CanvasPage, CanvasRedirect } from "./app/CanvasPage";
import { TooltipProvider } from "./components/ui/tooltip";
import { Toaster } from "./components/ui/sonner";
import { InboxPage, RequestPage } from "./pages/InboxPage";
import { RunPage, RunsPage } from "./pages/RunsPage";
import { NewWorkflowPage, WorkflowsPage } from "./pages/WorkflowsPage";
import { WorkflowPage } from "./pages/WorkflowPage";
import { SourcesPage } from "./pages/SourcesPage";
import { ServicesPage } from "./pages/ServicesPage";
import { ActivityPage } from "./pages/ActivityPage";
import { GuidePage } from "./pages/GuidePage";
import { SettingsPage } from "./pages/SettingsPage";
import { SecretsPage } from "./pages/SecretsPage";
import { SetupPage } from "./pages/SetupPage";
import { DesignPage } from "./pages/DesignPage";

initIdentityOverride();

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <CanvasRedirect /> },
      { path: "c/:canvasId", element: <CanvasPage /> },
      { path: "inbox", element: <InboxPage /> },
      { path: "requests/:id", element: <RequestPage /> },
      { path: "runs", element: <RunsPage /> },
      { path: "runs/:id", element: <RunPage /> },
      { path: "workflows", element: <WorkflowsPage /> },
      { path: "workflows/new", element: <NewWorkflowPage /> },
      { path: "workflows/:id", element: <WorkflowPage /> },
      { path: "sources", element: <SourcesPage /> },
      { path: "services", element: <ServicesPage /> },
      { path: "activity", element: <ActivityPage /> },
      { path: "secrets", element: <SecretsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "setup", element: <SetupPage /> },
      { path: "guide", element: <GuidePage /> },
      { path: "design", element: <DesignPage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider delayDuration={300}>
        <RouterProvider router={router} />
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
