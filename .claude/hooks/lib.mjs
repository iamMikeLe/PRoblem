// Shared helpers for hook scripts. Hooks receive a JSON payload on stdin.
export async function readHookInput() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
