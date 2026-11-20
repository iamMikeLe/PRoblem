import {
  Button,
  Caption1,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  makeStyles,
  Spinner,
  Subtitle2,
  Text,
  tokens,
} from "@fluentui/react-components";
import { SaveBitbucketCredentialsSchema } from "@problem/shared";
import { useState } from "react";
import {
  useBitbucketStatus,
  useRemoveBitbucket,
  useSaveBitbucket,
  useTestBitbucket,
} from "./queries.ts";

const useStyles = makeStyles({
  section: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  muted: { color: tokens.colorNeutralForeground3 },
  code: { fontFamily: tokens.fontFamilyMonospace },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalS,
    alignItems: "center",
  },
});

/**
 * Bitbucket Cloud credentials (ADR 0019): an Atlassian email and an API token. The token is sent
 * to the main process once, stored encrypted there, and never shown or sent back: the field is
 * always empty, and the page only knows whether one is saved and for which email.
 */
export function BitbucketSettings() {
  const styles = useStyles();
  const status = useBitbucketStatus();
  const save = useSaveBitbucket();
  const remove = useRemoveBitbucket();
  const test = useTestBitbucket();
  const [email, setEmail] = useState<string>();
  const [token, setToken] = useState("");
  const [touched, setTouched] = useState(false);

  const saved = status.data;
  const shownEmail = email ?? saved?.email ?? "";
  const parsed = SaveBitbucketCredentialsSchema.safeParse({ email: shownEmail.trim(), token });
  const problem = (field: "email" | "token") =>
    touched
      ? (parsed.error?.issues.find((issue) => issue.path[0] === field)?.message ?? null)
      : null;
  const busy = save.isPending || remove.isPending || test.isPending;
  /** One action's messages replace the others'. */
  const clearResults = () => {
    save.reset();
    remove.reset();
    test.reset();
  };

  return (
    <section className={styles.section} aria-labelledby="bitbucket-heading">
      <Subtitle2 as="h3" id="bitbucket-heading">
        Bitbucket
      </Subtitle2>
      <Text className={styles.muted}>
        To review Bitbucket Cloud pull requests, add your Atlassian account email and an API token
        with scopes (Atlassian account settings, Security, API tokens), with the Bitbucket scopes{" "}
        <span className={styles.code}>read:repository</span>,{" "}
        <span className={styles.code}>read:pullrequest</span> and{" "}
        <span className={styles.code}>write:pullrequest</span>. The token is encrypted with your
        system keychain and only ever sent to Bitbucket.
      </Text>
      {status.isLoading && <Spinner size="small" label="Loading" />}
      {status.error && (
        <MessageBar intent="error">
          <MessageBarBody>
            Could not read the Bitbucket settings: {status.error.message}
          </MessageBarBody>
        </MessageBar>
      )}
      {saved && (
        <Caption1 className={styles.muted}>
          {saved.configured ? `Saved for ${saved.email ?? "your account"}.` : "No token saved."}
        </Caption1>
      )}
      <Field
        label="Atlassian email"
        required
        {...(saved?.configured ? { hint: "Changing it needs the token again." } : {})}
        validationMessage={problem("email")}
      >
        <Input
          type="email"
          value={shownEmail}
          autoComplete="off"
          onChange={(_, data) => setEmail(data.value)}
        />
      </Field>
      <Field
        label="API token"
        required
        hint={
          saved?.configured
            ? "A token is saved; it is never shown. Paste a new one to replace it."
            : "Atlassian shows a new token only once: paste it here."
        }
        validationMessage={problem("token")}
      >
        <Input
          type="password"
          value={token}
          autoComplete="off"
          onChange={(_, data) => setToken(data.value)}
        />
      </Field>
      {(
        [
          ["save", save.error],
          ["remove", remove.error],
          ["test", test.error],
        ] as const
      ).map(
        ([action, error]) =>
          error && (
            <MessageBar key={action} intent="error">
              <MessageBarBody>{error.message}</MessageBarBody>
            </MessageBar>
          ),
      )}
      {test.data && (
        <MessageBar intent={test.data.ok ? "success" : "error"}>
          <MessageBarBody>{test.data.message}</MessageBarBody>
        </MessageBar>
      )}
      <div className={styles.actions}>
        <Button
          appearance="primary"
          disabledFocusable={busy || token === ""}
          onClick={() => {
            setTouched(true);
            if (!parsed.success) return;
            clearResults();
            save.mutate(parsed.data, {
              onSuccess: () => {
                setToken("");
                setEmail(undefined);
                setTouched(false);
              },
            });
          }}
        >
          Save credentials
        </Button>
        {/* It tests what is saved: a pasted, unsaved token would give a misleading answer. */}
        <Button
          disabledFocusable={busy || !saved?.configured || token !== ""}
          onClick={() => {
            clearResults();
            test.mutate();
          }}
        >
          Test connection
        </Button>
        <Button
          disabledFocusable={busy || !saved?.configured}
          onClick={() => {
            clearResults();
            remove.mutate();
          }}
        >
          Remove credentials
        </Button>
        {save.isSuccess && token === "" && <Caption1 className={styles.muted}>Saved.</Caption1>}
      </div>
    </section>
  );
}
