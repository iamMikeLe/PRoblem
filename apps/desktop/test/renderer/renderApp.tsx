import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { App } from "../../src/renderer/src/app/App.tsx";
import { ThemedProvider } from "../../src/renderer/src/app/ThemedProvider.tsx";

export function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemedProvider>
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>
    </ThemedProvider>,
  );
}
