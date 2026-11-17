---
name: api-contract
description: How to add or change an HTTP endpoint or WebSocket event in ReviewRoom end to end - zod schema in packages/shared, Fastify route with validation, typed client call, React Query hook, and tests. Use for any change to /api/* routes or server events.
---

# Add or change an API contract

The shared zod schema is the contract. Server and web both import it; neither defines its own
version of the same shape.

## 1. Schema (`packages/shared/src`)

- Domain shapes go in `domain.ts`, request/response shapes in `api.ts`, WS events in `events.ts`.
- Name schemas `<Thing>Schema` and export the inferred type as `<Thing>`:

```ts
export const CreateProjectRequestSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1).optional(),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;
```

- New WS event: add a member to the `ServerEventSchema` discriminated union with a dotted
  `type` (`review.status`, `finding.updated`).

## 2. Server route (`apps/server/src`)

- Feature routes live in `src/modules/<feature>/routes.ts` as a Fastify plugin registered in
  `app.ts`. Data access lives next to it in `repository.ts` (plain functions over `DatabaseSync`).
- Parse input with `Schema.safeParse(request.body)`; on failure reply `400` with the shared
  `ApiError` shape: `{ error: { code: "invalid_request", message } }`.
- Annotate the handler's return type with the response type so drift fails the type check.
- Broadcast state changes through `EventHub.broadcast()` after the write commits.

## 3. Web client (`apps/web/src`)

- Add a method to `api` in `src/lib/api.ts` that passes the response schema to `request()`.
- Wrap it in a React Query hook in the feature folder (`src/features/<feature>/queries.ts`).
  Mutations invalidate or update the affected query keys.
- WS events update the store/query cache in one place (the socket handler), not in components.

## 4. Tests

- Shared: schema accepts a valid example and rejects the important invalid ones.
- Server: `createTestApp()` + `app.inject()` for success, validation failure, and not-found.
- Web: component test with `fetch` stubbed, asserting what the user sees.
