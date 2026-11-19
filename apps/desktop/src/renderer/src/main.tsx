import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";
import { ErrorBoundary, reportError } from "./app/ErrorBoundary.tsx";
import { ThemedProvider } from "./app/ThemedProvider.tsx";
import "./global.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

// Errors outside React rendering (event handlers, timers, promises) reach the log too.
window.addEventListener("error", (event) => reportError(event.error ?? event.message));
window.addEventListener("unhandledrejection", (event) => reportError(event.reason));

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing from index.html");

createRoot(root).render(
  <StrictMode>
    <ThemedProvider>
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary what="PRoblem" whole>
          <App />
        </ErrorBoundary>
      </QueryClientProvider>
    </ThemedProvider>
  </StrictMode>,
);
