import { FluentProvider, teamsDarkTheme } from "@fluentui/react-components";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App.tsx";

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <FluentProvider theme={teamsDarkTheme}>
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>
    </FluentProvider>,
  );
}

describe("App shell", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ status: "ok", version: "0.1.0", uptimeSeconds: 1 })),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the rail, review list and the first review", async () => {
    renderApp();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Reviews" })).toBeTruthy();
    expect(await screen.findByText("Server 0.1.0")).toBeTruthy();
  });

  it("opens a review when it is clicked in the list", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: /Dark mode for settings/ }));
    expect(screen.getByRole("heading", { name: "#1290 Dark mode for settings" })).toBeTruthy();
  });
});
