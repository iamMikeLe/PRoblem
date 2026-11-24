# 0019. Bitbucket Cloud through a git host interface and an API token

- Status: accepted (amends ADR 0014: channel names, mention guard)
- Date: 2026-11-20

## Context
Pull requests worked only on GitHub, through the `gh` CLI, which also handled login (ADR 0014).
Teams on Bitbucket Cloud need the same features: start a review from a pull request, link a
branch review to its open pull request, read the discussion, and post findings. Bitbucket has no
`gh`-like CLI with its own login, no `refs/pull/*` refs, and no way to post a review at once.

## Options
1. **Parallel `bitbucket:*` channels and services.** Con: duplicates everything that is not about
   the host (the PR link cache, the digest, Activity, the preview's line placement, the one post
   at a time guard) in main and in the renderer.
2. **One `GitHost` interface with a GitHub and a Bitbucket implementation**, chosen per review from
   the PR link or the project's remote. Con: a rename of the `github:*` channels and folders.

For the login:
1. **App passwords.** Deprecated by Atlassian: not an option.
2. **OAuth sign-in.** Con: an OAuth consumer must be registered, a client secret shipped in the
   app, and a local redirect handled.
3. **An Atlassian email and an API token with scopes**, entered once in Settings.

## Decision
A `GitHost` interface (`main/pullrequests/host.ts`) and an API token:
- **Hosts.** GitHub keeps `gh` (GraphQL, one atomic review). Bitbucket uses its REST API from the
  main process. The pull request service picks the host by the PR link or the project's main
  remote. `github:*` channels became `pr:*`; links carry `host`, and older ones read as GitHub.
- **Credentials.** The email and token are stored in a `credentials` table (migration 11), the
  token encrypted with Electron `safeStorage` (the OS keychain). Saving is refused when only
  plain-text storage exists (Linux `basic_text`). The renderer only ever gets
  `{ configured, email }`: the handlers parse their answer with that schema on the way out.
- **HTTP.** Basic auth to `https://api.bitbucket.org/2.0` only, no redirects followed, a 30 s
  timeout, `next` page links checked to stay on the API (at most 10 pages), every answer
  validated with zod. Links to pull request pages are built by the app, never taken from answers.
- **Starting a review.** `#12` means pull request 12 on the host of the project's main remote.
  Bitbucket's head is the source branch, fetched after git checks its name. A fork is fetched from
  a URL built from its checked name in the scheme of the project's remote (so the user's own git
  credentials apply), never from the API's clone links.
- **Posting.** Bitbucket gets one comment per inline finding, then one general comment with the
  summary and the other findings, then approve or request changes only if all of that was
  posted. Each finding is marked as soon as its comment exists. A failure part-way is
  `post_partial`, and a timeout marks that finding as possibly posted, as on GitHub.
- **Mentions.** The guard also covers Bitbucket's `@{account-id}` form.

## Consequences
- The renderer is host-neutral apart from labels ("Post a review to Bitbucket").
- A post to Bitbucket can stop part-way and leave some comments on the pull request; the user is
  told how many, and the rest stay selectable.
- Bitbucket comments are not pinned to a commit: a push between the preview and the post could
  put an inline comment on a moved line. The preview refuses to post when the head has moved, so
  the window is the few seconds of posting.
- Bitbucket reports a 12-character head hash, so heads are compared as prefixes.
- "Test connection" calls `/user`. A token without profile access answers 403 there, which is
  reported as working, since pull requests do not need it.
- A branch literally named `#12` can no longer be reviewed by typing its name.
- Everything is tested against a fake Bitbucket; it has not yet been tried against the real API.
