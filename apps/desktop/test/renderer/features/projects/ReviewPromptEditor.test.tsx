import { DEFAULT_REVIEW_PROMPT } from "@reviewroom/shared";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderApp } from "../../renderApp.tsx";
import { makeProject, removeBridge, stubBridge } from "../../stubBridge.ts";

async function openPrompt() {
  renderApp();
  fireEvent.click(screen.getByRole("button", { name: "Projects" }));
  return screen.findByRole("textbox", { name: /Review prompt/ });
}

const saveButton = () => screen.getByRole("button", { name: "Save" });

describe("Review prompt editor", () => {
  afterEach(() => {
    cleanup();
    removeBridge();
  });

  it("shows the stored prompt with a Default badge, Save disabled until edited", async () => {
    stubBridge([makeProject("p1", "payments-api")]);
    const editor = await openPrompt();
    expect(editor).toHaveProperty("value", DEFAULT_REVIEW_PROMPT);
    expect(screen.getByText("Default")).toBeTruthy();
    expect(saveButton().hasAttribute("disabled")).toBe(true);
  });

  it("saves an edited prompt with PATCH and marks it Custom", async () => {
    const api = stubBridge([makeProject("p1", "payments-api")]);
    const editor = await openPrompt();
    fireEvent.change(editor, { target: { value: "  Focus on SQL injection.  " } });
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    fireEvent.click(saveButton());

    expect(await screen.findByText("Custom")).toBeTruthy();
    expect(api.calls).toContainEqual({
      channel: "projects:update",
      input: { id: "p1", patch: { reviewPrompt: "Focus on SQL injection." } },
    });
  });

  it("does not allow saving an empty prompt", async () => {
    stubBridge([makeProject("p1", "payments-api")]);
    const editor = await openPrompt();
    fireEvent.change(editor, { target: { value: "   " } });
    expect(screen.getByText("The prompt cannot be empty.")).toBeTruthy();
    expect(saveButton().hasAttribute("disabled")).toBe(true);
  });

  it("shows an error when saving fails and clears it on the next edit", async () => {
    const api = stubBridge([makeProject("p1", "payments-api")]);
    api.updateError = { code: "internal", message: "Something went wrong" };
    const editor = await openPrompt();
    fireEvent.change(editor, { target: { value: "New prompt" } });
    fireEvent.click(saveButton());

    expect(await screen.findByText("Could not save the prompt: Something went wrong")).toBeTruthy();
    fireEvent.change(editor, { target: { value: "New prompt!" } });
    expect(screen.queryByText(/Could not save the prompt/)).toBeNull();
  });

  it("discards an unsaved draft when another project is selected", async () => {
    stubBridge([
      makeProject("p1", "payments-api", { reviewPrompt: "Prompt one" }),
      makeProject("p2", "web-portal", { reviewPrompt: "Prompt two" }),
    ]);
    const editor = await openPrompt();
    fireEvent.change(editor, { target: { value: "Edited but not saved" } });

    const pane = screen.getByRole("complementary", { name: "Projects" });
    fireEvent.click(within(pane).getByRole("button", { name: /web-portal/ }));
    expect(screen.getByRole("textbox", { name: /Review prompt/ })).toHaveProperty(
      "value",
      "Prompt two",
    );
    fireEvent.click(within(pane).getByRole("button", { name: /payments-api/ }));
    expect(screen.getByRole("textbox", { name: /Review prompt/ })).toHaveProperty(
      "value",
      "Prompt one",
    );
  });

  it("resets a custom prompt to the default, which the user then saves", async () => {
    const api = stubBridge([makeProject("p1", "payments-api", { reviewPrompt: "Custom text" })]);
    const editor = await openPrompt();
    expect(screen.getByText("Custom")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    expect(editor).toHaveProperty("value", DEFAULT_REVIEW_PROMPT);
    fireEvent.click(saveButton());

    await waitFor(() => expect(screen.getByText("Default")).toBeTruthy());
    expect(api.projects[0]?.reviewPrompt).toBe(DEFAULT_REVIEW_PROMPT);
  });
});
