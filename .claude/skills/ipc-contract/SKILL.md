---
name: ipc-contract
description: How to add or change an IPC channel or main → renderer event in ReviewRoom end to end - zod schemas and channel in packages/shared, Electron-free handler in the main process, typed api method and React Query hook in the renderer, and tests on both sides. Use for any change to what the UI asks the main process or what main pushes to the UI.
---

# Add or change an IPC channel

The renderer never talks to Node directly. Every request goes through one contract
(`packages/shared/src/ipc.ts`) that both sides import.

## 1. Contract (`packages/shared/src`)

1. Add the channel name to `IPC_CHANNELS` in `channels.ts` (`<area>:<verb>`, e.g. `reviews:create`).
   This list is also the preload's allowlist.
2. Add schemas and the entry in `ipcContract` in `ipc.ts`:

```ts
export const CreateReviewRequestSchema = z.strictObject({
  projectId: z.string().min(1),
  source: ReviewSourceSchema,
  isolated: z.boolean(),
});

export const ipcContract = {
  // ...
  "reviews:create": { input: CreateReviewRequestSchema, output: ReviewSchema },
} as const satisfies Record<IpcChannel, { input: z.ZodType; output: z.ZodType }>;
```

- Use `z.undefined()` for no input and `z.null()` for no output.
- New error codes go in `AppErrorCodeSchema`.
- A new event: add a member to `AppEventSchema` in `events.ts` (`type: "review.output"`).
- The compiler fails until `IPC_CHANNELS` and `ipcContract` agree, and until `createHandlers`
  implements the new channel.

## 2. Main process (`apps/desktop/src/main`)

- Put the logic in an Electron-free service (`<feature>/service.ts`) that takes its dependencies
  (db, logger, clock, spawn) as arguments. Data access in `<feature>/repository.ts`.
- Throw `AppFailure(code, message)` for expected failures; let everything else throw (the
  dispatcher logs it and returns `internal` without leaking details).
- Bind the channel in `ipc/handlers.ts`. The handler receives input already parsed (trimmed,
  defaults applied) by the contract.
- Push events with `broadcast(event)` from `ipc/register.ts`, after the write commits.
- Anything needing Electron (dialogs, notifications, shell) is passed into `createHandlers` as a
  function from `index.ts`, so handlers stay testable.

## 3. Renderer (`apps/desktop/src/renderer/src`)

- Add a method to `api` in `lib/api.ts` using `call("<channel>", input)`; it validates the output.
- Wrap it in a React Query hook in `features/<feature>/queries.ts`. Mutations invalidate or update
  the affected query keys.
- Events update the store/query cache in one place (the `onEvent` subscriber), not in components.

## 4. Tests

- Shared: the schema accepts a valid example and rejects the important invalid ones.
- Main: service tests against `openDatabase(":memory:")` and a temp git repo (`test/main/gitFixture.ts`);
  a dispatcher test if the channel has unusual input.
- Renderer: extend `test/renderer/stubBridge.ts` with the channel, then assert on what the user
  sees and on `calls` (it parses inputs with the real contract).
