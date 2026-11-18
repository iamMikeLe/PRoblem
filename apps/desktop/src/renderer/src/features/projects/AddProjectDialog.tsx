import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { FolderOpenRegular } from "@fluentui/react-icons";
import { PROJECT_NAME_MAX, PROJECT_PATH_MAX, type Project } from "@problem/shared";
import { type FormEvent, useState } from "react";
import { api } from "../../lib/api.ts";
import { useCreateProject } from "./queries.ts";

const useStyles = makeStyles({
  content: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
});

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (project: Project) => void;
}

/** Registers a git repository as a project, by its folder path on this machine. */
export function AddProjectDialog({ open, onClose, onCreated }: Props) {
  const styles = useStyles();
  const create = useCreateProject();
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [browseError, setBrowseError] = useState<string | undefined>();

  const close = () => {
    // The request cannot be cancelled, so the dialog stays until it settles.
    if (create.isPending) return;
    setPath("");
    setName("");
    setBrowseError(undefined);
    create.reset();
    onClose();
  };

  /** Fills the path from the native folder picker; cancelling keeps what was typed. */
  const browse = async () => {
    try {
      const folder = await api.dialog.pickFolder();
      setBrowseError(undefined);
      if (folder === null) return;
      setPath(folder);
      if (create.isError) create.reset();
    } catch (error) {
      setBrowseError(error instanceof Error ? error.message : "Could not open the folder picker");
    }
  };

  const error = create.isError ? create.error.message : browseError;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    create.mutate(trimmedName ? { path: path.trim(), name: trimmedName } : { path: path.trim() }, {
      onSuccess: (project) => {
        setPath("");
        setName("");
        create.reset();
        onCreated(project);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={(_, data) => (data.open ? undefined : close())}>
      <DialogSurface>
        <form onSubmit={submit}>
          <DialogBody>
            <DialogTitle>Add project</DialogTitle>
            <DialogContent className={styles.content}>
              <Field
                label="Repository folder"
                required
                hint="Browse, or type the path to a git repository on this machine. ~/ works too."
                {...(error ? { validationState: "error", validationMessage: error } : {})}
              >
                <Input
                  value={path}
                  onChange={(_, data) => {
                    setPath(data.value);
                    setBrowseError(undefined);
                    if (create.isError) create.reset();
                  }}
                  maxLength={PROJECT_PATH_MAX}
                  placeholder="~/code/my-repo"
                  contentAfter={
                    <Button
                      appearance="transparent"
                      size="small"
                      icon={<FolderOpenRegular />}
                      aria-label="Browse for a folder"
                      disabled={create.isPending}
                      onClick={() => void browse()}
                    />
                  }
                />
              </Field>
              <Field label="Name" hint="Defaults to the folder name.">
                <Input
                  value={name}
                  onChange={(_, data) => setName(data.value)}
                  maxLength={PROJECT_NAME_MAX}
                />
              </Field>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={close} disabled={create.isPending}>
                Cancel
              </Button>
              <Button
                appearance="primary"
                type="submit"
                disabled={path.trim() === "" || create.isPending}
              >
                {create.isPending ? "Adding…" : "Add"}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}
