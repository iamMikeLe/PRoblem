import type { PostPreview, PrConversation } from "@problem/shared";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useConversationStore } from "../../../../src/renderer/src/features/conversation/store.ts";
import { findDialog } from "../../dialogs.ts";
import { renderApp } from "../../renderApp.tsx";
import { makeProject, makeReview, removeBridge, stubBridge } from "../../stubBridge.ts";

const project = makeProject("p1", "payments-api");
const PR = {
  host: "github",
  repo: "acme/payments",
  number: 7,
  url: "https://github.com/acme/payments/pull/7",
} as const;

const conversation: PrConversation = {
  status: "ok",
  pullRequest: { ...PR, title: "Retry webhooks", headSha: "a".repeat(40) },
  threads: [
    {
      id: "T1",
      path: "src/app.ts",
      line: 12,
      isResolved: true,
      isOutdated: false,
      comments: [
        {
          id: "C1",
          author: "alice",
          body: "Why **forever**?",
          createdAt: "2026-11-18T09:00:00Z",
          url: "x",
        },
      ],
    },
  ],
  comments: [
    { id: "I1", author: "bob", body: "Looks good", createdAt: "2026-11-18T08:00:00Z", url: "x" },
  ],
  reviews: [
    {
      id: "R1",
      author: "carol",
      state: "CHANGES_REQUESTED",
      body: "Add tests",
      submittedAt: "2026-11-18T09:10:00Z",
      url: "x",
    },
  ],
  truncated: false,
};

const preview: PostPreview = {
  status: "ok",
  pullRequest: PR,
  upToDate: true,
  items: [
    {
      number: 1,
      placement: "inline",
      reason: null,
      text: "**Major: Retries never stop**\n\nIt loops.",
      selected: true,
      postedUrl: null,
    },
    {
      number: 2,
      placement: "summary",
      reason: "line 90 is not part of the diff",
      text: "**Minor: Naming** (`src/app.ts:90`)\n\nx",
      selected: false,
      postedUrl: null,
    },
  ],
};

async function openTab(name: RegExp) {
  renderApp();
  fireEvent.click(await screen.findByRole("tab", { name }));
}

describe("GitHub", () => {
  afterEach(() => {
    cleanup();
    removeBridge();
    useConversationStore.setState({ entries: {}, live: {}, statuses: {}, approvals: {} });
  });

  it("shows the pull request's reviews, threads and comments", async () => {
    const api = stubBridge([project], [makeReview("r1", project)]);
    api.conversations.r1 = conversation;
    await openTab(/PR comments/);
    const threads = await screen.findByRole("region", { name: "Review threads" });
    expect(within(threads).getByText("src/app.ts:12")).toBeTruthy();
    expect(within(threads).getByText("Resolved")).toBeTruthy();
    expect(within(threads).getByText("forever").tagName).toBe("STRONG");
    expect(
      within(screen.getByRole("region", { name: "Reviews" })).getByText("Changes requested"),
    ).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Conversation" })).getByText("Looks good"),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open acme/payments#7 on GitHub" }));
    await waitFor(() => expect(api.opened).toEqual([PR.url]));
  });

  it("explains when a review has no pull request", async () => {
    const api = stubBridge([project], [makeReview("r1", project)]);
    api.conversations.r1 = {
      status: "none",
      reason: "No open pull request has feature/r1 as its branch.",
    };
    await openTab(/PR comments/);
    expect(
      await screen.findByText("No open pull request has feature/r1 as its branch."),
    ).toBeTruthy();
  });

  it("posts only after the preview, with accepted findings pre-selected", async () => {
    const api = stubBridge([project], [makeReview("r1", project)]);
    api.previews.r1 = preview;
    await openTab(/Findings/);
    fireEvent.click(await screen.findByRole("button", { name: "Post to pull request…" }));
    const dialog = await findDialog("Post a review to GitHub");
    expect(await within(dialog).findByText("Findings (1 of 2 selected)")).toBeTruthy();
    expect(
      (
        within(dialog).getByRole("checkbox", {
          name: /#1 Major: Retries never stop/,
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(
      within(dialog).getByText(/in the summary: line 90 is not part of the diff/),
    ).toBeTruthy();
    expect(api.posts).toEqual([]);

    // Requesting changes needs a summary.
    fireEvent.click(within(dialog).getByRole("radio", { name: "Request changes" }));
    const post = within(dialog).getByRole("button", { name: "Post to acme/payments#7" });
    expect(post.hasAttribute("disabled")).toBe(true);
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Summary/ }), {
      target: { value: "Two issues." },
    });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /#2 Minor: Naming/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Post to acme/payments#7" }));

    await waitFor(() =>
      expect(api.posts).toEqual([
        {
          id: "r1",
          event: "REQUEST_CHANGES",
          body: "Two issues.",
          findings: [
            { number: 1, text: "**Major: Retries never stop**\n\nIt loops." },
            { number: 2, text: "**Minor: Naming** (`src/app.ts:90`)\n\nx" },
          ],
        },
      ]),
    );
    expect(await screen.findByText("Posted to GitHub.")).toBeTruthy();
  });

  it("names Bitbucket and how it posts, for a Bitbucket pull request", async () => {
    const api = stubBridge([project], [makeReview("r1", project)]);
    const url = "https://bitbucket.org/acme/payments/pull-requests/7";
    api.previews.r1 = { ...preview, pullRequest: { ...PR, host: "bitbucket", url } };
    await openTab(/Findings/);
    fireEvent.click(await screen.findByRole("button", { name: "Post to pull request…" }));
    const dialog = await findDialog("Post a review to Bitbucket");
    expect(within(dialog).getByText(/each finding as its own comment/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Post to acme/payments#7" }));
    expect(await screen.findByText("Posted to Bitbucket.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open on Bitbucket" })).toBeTruthy();
  });

  it("lets the user edit a finding's text, preview it as markdown, reset it, and posts the edit", async () => {
    const api = stubBridge([project], [makeReview("r1", project)]);
    api.previews.r1 = preview;
    await openTab(/Findings/);
    fireEvent.click(await screen.findByRole("button", { name: "Post to pull request…" }));
    const dialog = await findDialog("Post a review to GitHub");
    const text = (await within(dialog).findByRole("textbox", {
      name: "Text of finding #1",
    })) as HTMLTextAreaElement;
    expect(text.value).toBe("**Major: Retries never stop**\n\nIt loops.");
    expect(within(dialog).getAllByText("Markdown supported").length).toBeGreaterThan(0);
    expect(within(dialog).queryByRole("button", { name: "Reset to Claude's text" })).toBeNull();

    fireEvent.change(text, { target: { value: "**Retries** never stop, cc @alice" } });
    expect(within(dialog).getByText("edited")).toBeTruthy();
    expect(within(dialog).getByText(/an @name you type notifies that person/)).toBeTruthy();

    // Preview renders the markdown as GitHub would.
    const tabs = within(dialog).getByRole("tablist", {
      name: "Text of finding #1: write or preview",
    });
    fireEvent.click(within(tabs).getByRole("tab", { name: "Preview" }));
    const shown = within(dialog).getByRole("region", { name: "Preview of Text of finding #1" });
    expect(within(shown).getByText("Retries").tagName).toBe("STRONG");

    // Reset brings Claude's text back; editing again is what gets posted.
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset to Claude's text" }));
    fireEvent.click(within(tabs).getByRole("tab", { name: "Write" }));
    const again = within(dialog).getByRole("textbox", {
      name: "Text of finding #1",
    }) as HTMLTextAreaElement;
    expect(again.value).toBe("**Major: Retries never stop**\n\nIt loops.");
    expect(within(dialog).queryByText("edited")).toBeNull();

    // An empty text cannot be posted.
    fireEvent.change(again, { target: { value: "   " } });
    expect(within(dialog).getByRole("alert").textContent).toBe("A finding's text cannot be empty.");
    const post = within(dialog).getByRole("button", { name: "Post to acme/payments#7" });
    expect(post.hasAttribute("disabled")).toBe(true);

    fireEvent.change(again, { target: { value: "Retries never stop.\n\n- [ ] add a cap" } });
    fireEvent.click(post);
    await waitFor(() =>
      expect(api.posts).toEqual([
        {
          id: "r1",
          event: "COMMENT",
          body: "",
          findings: [{ number: 1, text: "Retries never stop.\n\n- [ ] add a cap" }],
        },
      ]),
    );
  });

  it("previews the summary as markdown", async () => {
    const api = stubBridge([project], [makeReview("r1", project)]);
    api.previews.r1 = preview;
    await openTab(/Findings/);
    fireEvent.click(await screen.findByRole("button", { name: "Post to pull request…" }));
    const dialog = await findDialog("Post a review to GitHub");
    fireEvent.change(await within(dialog).findByRole("textbox", { name: /Summary/ }), {
      target: { value: "Looks _mostly_ good." },
    });
    fireEvent.click(
      within(within(dialog).getByRole("tablist", { name: "Summary: write or preview" })).getByRole(
        "tab",
        {
          name: "Preview",
        },
      ),
    );
    expect(within(dialog).getByText("mostly").tagName).toBe("EM");
  });

  it("does not post to a pull request that moved on", async () => {
    const api = stubBridge([project], [makeReview("r1", project)]);
    api.previews.r1 = { ...preview, upToDate: false };
    await openTab(/Findings/);
    fireEvent.click(await screen.findByRole("button", { name: "Post to pull request…" }));
    const dialog = await findDialog();
    expect(await within(dialog).findByText(/The pull request has new commits/)).toBeTruthy();
    expect(
      within(dialog)
        .getByRole("button", { name: "Post to acme/payments#7" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });
});
