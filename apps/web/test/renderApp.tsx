import { FluentProvider, teamsDarkTheme } from "@fluentui/react-components";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { App } from "../src/app/App.tsx";

export function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <FluentProvider theme={teamsDarkTheme}>
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>
    </FluentProvider>,
  );
}
