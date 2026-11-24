import { teamsDarkTheme, teamsLightTheme } from "@fluentui/react-components";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
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

describe("Bitbucket settings", () => {
  afterEach(() => {
    cleanup();
    removeBridge();
  });

  async function openBitbucket() {
    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    return within(await screen.findByRole("region", { name: "Bitbucket" }));
  }

  it("saves the email and token, then empties the token field", async () => {
    const api = stubBridge([makeProject("p1", "payments-api")]);
    const section = await openBitbucket();
    expect(await section.findByText("No token saved.")).toBeTruthy();
    const save = section.getByRole("button", { name: "Save credentials" });
    expect(save.getAttribute("aria-disabled")).toBe("true");
    expect(
      section.getByRole("button", { name: "Test connection" }).getAttribute("aria-disabled"),
    ).toBe("true");

    fireEvent.change(section.getByRole("textbox", { name: "Atlassian email" }), {
      target: { value: "not-an-email" },
    });
    const token = section.getByLabelText(/API token/) as HTMLInputElement;
    expect(token.type).toBe("password");
    fireEvent.change(token, { target: { value: "ATATT-token" } });
    fireEvent.click(save);
    expect(await section.findByText("Enter the email of your Atlassian account.")).toBeTruthy();

    fireEvent.change(section.getByRole("textbox", { name: "Atlassian email" }), {
      target: { value: "me@example.com" },
    });
    fireEvent.click(save);
    expect(await section.findByText("Saved for me@example.com.")).toBeTruthy();
    expect(api.calls).toContainEqual({
      channel: "bitbucket:save",
      input: { email: "me@example.com", token: "ATATT-token" },
    });
    await waitFor(() => expect(token.value).toBe(""));
    expect(await section.findByText(/Paste a new one to replace it/)).toBeTruthy();
  });

  it("tests the saved connection and removes it", async () => {
    const api = stubBridge([makeProject("p1", "payments-api")]);
    api.bitbucket = { configured: true, email: "me@example.com" };
    api.bitbucketTest = { ok: false, message: "Bitbucket refused the email and API token." };
    const section = await openBitbucket();
    expect(await section.findByText("Saved for me@example.com.")).toBeTruthy();
    // The token is never filled in from what was saved.
    expect((section.getByLabelText(/API token/) as HTMLInputElement).value).toBe("");

    fireEvent.click(section.getByRole("button", { name: "Test connection" }));
    expect(await section.findByText("Bitbucket refused the email and API token.")).toBeTruthy();

    // Test connection checks what is saved, so it waits while a new token is typed in.
    const typed = section.getByLabelText(/API token/) as HTMLInputElement;
    fireEvent.change(typed, { target: { value: "new-token" } });
    expect(
      section.getByRole("button", { name: "Test connection" }).getAttribute("aria-disabled"),
    ).toBe("true");
    fireEvent.change(typed, { target: { value: "" } });

    fireEvent.click(section.getByRole("button", { name: "Remove credentials" }));
    expect(await section.findByText("No token saved.")).toBeTruthy();
    // The failed test's message is gone with the credentials it was about.
    expect(section.queryByText("Bitbucket refused the email and API token.")).toBeNull();
    expect(api.calls.map((c) => c.channel)).toContain("bitbucket:remove");
  });
});
