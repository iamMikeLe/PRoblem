import { teamsDarkTheme, teamsLightTheme } from "@fluentui/react-components";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadTheme, useTheme } from "../../../../src/renderer/src/lib/theme.ts";
import { renderApp } from "../../renderApp.tsx";
import { makeProject, removeBridge, stubBridge } from "../../stubBridge.ts";

describe("Settings", () => {
  afterEach(() => {
    cleanup();
    removeBridge();
    window.localStorage.clear();
    useTheme.setState({ name: "dark" });
  });

  it("chooses an editor preset or a custom command", async () => {
    const api = stubBridge([makeProject("p1", "payments-api")]);
    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));

    const vscode = await screen.findByRole("radio", { name: /Visual Studio Code/ });
    expect((vscode as HTMLInputElement).checked).toBe(true);
    const save = screen.getByRole("button", { name: "Save" });
    expect(save.getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(screen.getByRole("radio", { name: /Custom command/ }));
    const command = screen.getByRole("textbox", { name: /Command/ });
    fireEvent.change(command, { target: { value: "subl" } });
    fireEvent.blur(command);
    expect(await screen.findByText("The command must contain {file}.")).toBeTruthy();
    expect(save.getAttribute("aria-disabled")).toBe("true");

    fireEvent.change(command, { target: { value: "subl {file}:{line}" } });
    fireEvent.click(save);
    await waitFor(() =>
      expect(api.settings).toEqual({
        editor: { preset: "custom", customTemplate: "subl {file}:{line}" },
      }),
    );
    expect(await screen.findByText("Saved.")).toBeTruthy();
  });

  it("switches the theme at once and remembers it", async () => {
    stubBridge([makeProject("p1", "payments-api")]);
    renderApp();
    await waitFor(() =>
      expect(document.body.style.backgroundColor).toBe(
        hexToRgb(teamsDarkTheme.colorNeutralBackground1),
      ),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    expect((screen.getByRole("radio", { name: "Teams dark" }) as HTMLInputElement).checked).toBe(
      true,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Teams light" }));
    await waitFor(() =>
      expect(document.body.style.backgroundColor).toBe(
        hexToRgb(teamsLightTheme.colorNeutralBackground1),
      ),
    );
    expect(window.localStorage.getItem("problem.theme")).toBe("light");
    expect(loadTheme()).toBe("light");

    window.localStorage.setItem("problem.theme", "neon");
    expect(loadTheme()).toBe("dark");
  });
});

/** jsdom reports inline colors as rgb(). */
function hexToRgb(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}
