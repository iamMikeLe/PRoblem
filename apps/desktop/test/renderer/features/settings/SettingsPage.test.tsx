import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderApp } from "../../renderApp.tsx";
import { makeProject, removeBridge, stubBridge } from "../../stubBridge.ts";

describe("Settings", () => {
  afterEach(() => {
    cleanup();
    removeBridge();
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
});
