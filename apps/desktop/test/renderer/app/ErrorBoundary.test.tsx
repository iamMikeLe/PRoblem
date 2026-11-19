import { FluentProvider, teamsDarkTheme } from "@fluentui/react-components";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../../../src/renderer/src/app/ErrorBoundary.tsx";
import { removeBridge, type StubState, stubBridge } from "../stubBridge.ts";

let broken = true;
function Fragile({ name }: { name: string }) {
  if (broken) throw new Error(`${name} exploded`);
  return <p>{name} works</p>;
}

function show(resetKey: string) {
  return (
    <FluentProvider theme={teamsDarkTheme}>
      <p>Outside stays</p>
      <ErrorBoundary what="This tab" resetKey={resetKey}>
        <Fragile name={resetKey} />
      </ErrorBoundary>
    </FluentProvider>
  );
}

describe("ErrorBoundary", () => {
  let api: StubState;
  beforeEach(() => {
    broken = true;
    api = stubBridge();
    // React logs caught render errors to the console; expected here.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    removeBridge();
    vi.restoreAllMocks();
  });

  it("shows what failed instead of blanking the window, and reports it to the log", async () => {
    render(show("findings"));
    expect(screen.getByRole("alert").textContent).toContain("This tab stopped working.");
    expect(screen.getByText("findings exploded")).toBeTruthy();
    expect(screen.getByText("Outside stays")).toBeTruthy();
    await waitFor(() => expect(api.errors).toHaveLength(1));
    expect(api.errors[0]).toMatchObject({ message: "findings exploded" });
    expect(api.errors[0]?.componentStack).toContain("Fragile");
  });

  it("starts over on Try again, or when the user navigates elsewhere", () => {
    const { rerender } = render(show("findings"));
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("findings works")).toBeTruthy();

    broken = true;
    rerender(show("changes"));
    expect(screen.getByRole("alert")).toBeTruthy();
    broken = false;
    rerender(show("conversation"));
    expect(screen.getByText("conversation works")).toBeTruthy();
  });
});
