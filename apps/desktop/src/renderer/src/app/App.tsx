import {
  makeStyles,
  mergeClasses,
  Text,
  Toast,
  ToastBody,
  Toaster,
  ToastTitle,
  tokens,
  useId,
  useToastController,
} from "@fluentui/react-components";
import { lazy, Suspense, useState } from "react";
import { activityTarget } from "../features/activity/describe.ts";
import { useActivity, useUnreadActivity } from "../features/activity/queries.ts";
import { useLoadApprovals } from "../features/conversation/queries.ts";
import { useAppEvents } from "../features/conversation/useAppEvents.ts";
import { useProjects } from "../features/projects/queries.ts";
import { NewReviewDialog } from "../features/reviews/NewReviewDialog.tsx";
import { useReviews } from "../features/reviews/queries.ts";
import type { SearchTarget } from "../features/search/GlobalSearch.tsx";
import { usePanel } from "../lib/panel.ts";
import { useShortcuts } from "../lib/shortcuts.ts";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import { LoadingRows } from "./LoadingRows.tsx";
import { AppRail, type RailSection } from "./layout/AppRail.tsx";
import { ListPane } from "./layout/ListPane.tsx";
import { MainPane } from "./layout/MainPane.tsx";
import { TitleBar } from "./layout/TitleBar.tsx";
import { ShortcutsDialog } from "./ShortcutsDialog.tsx";

// Sections other than Reviews load when first opened, keeping startup to what it shows.
const ProjectsPane = lazy(() =>
  import("../features/projects/ProjectsPane.tsx").then((m) => ({ default: m.ProjectsPane })),
);
const ProjectDetail = lazy(() =>
  import("../features/projects/ProjectDetail.tsx").then((m) => ({ default: m.ProjectDetail })),
);
const ActivityPane = lazy(() =>
  import("../features/activity/ActivityPane.tsx").then((m) => ({ default: m.ActivityPane })),
);
const SettingsPage = lazy(() =>
  import("../features/settings/SettingsPage.tsx").then((m) => ({ default: m.SettingsPage })),
);

const useStyles = makeStyles({
  shell: {
    display: "grid",
    height: "100%",
    gridTemplateColumns: "68px 320px minmax(0, 1fr)",
    gridTemplateRows: "48px minmax(0, 1fr)",
    gridTemplateAreas: `"title title title" "rail list main"`,
  },
  // The reviews list collapsed to a strip of buttons.
  listCollapsed: { gridTemplateColumns: "68px auto minmax(0, 1fr)" },
  // Where a pane's error message goes when that pane fails.
  listArea: { gridArea: "list" },
  mainArea: { gridArea: "main" },
  wideArea: { gridColumn: "2 / -1", gridRow: 2 },
  placeholder: {
    gridArea: "main",
    display: "grid",
    placeItems: "center",
    color: tokens.colorNeutralForeground3,
  },
});

/** Teams-style shell: title bar, app rail, list pane, main pane. */
export function App() {
  const styles = useStyles();
  const reviewsList = usePanel("reviews.list", { initial: 320, min: 320, max: 320 });
  const [section, setSection] = useState<RailSection>("reviews");
  const [reviewId, setReviewId] = useState<string>();
  useAppEvents((id) => {
    setSection("reviews");
    setReviewId(id);
  });
  useLoadApprovals();
  const projects = useProjects();
  const reviews = useReviews();
  const [creating, setCreating] = useState(false);
  // The search result to show; a new object each time, so the same result can be opened twice.
  const [focus, setFocus] = useState<SearchTarget>();
  // The Activity row whose review the Activity section shows.
  const [activityId, setActivityId] = useState<string>();
  const activity = useActivity();
  const unread = useUnreadActivity();
  const toasterId = useId("toaster");
  const { dispatchToast } = useToastController(toasterId);

  // Selections fall back to the first item, so a closed review or removed project never leaves a blank.
  const reviewList = reviews.data ?? [];
  const selectedReview = reviewList.find((review) => review.id === reviewId) ?? reviewList[0];
  const [projectId, setProjectId] = useState<string>();
  const selectedProject =
    projects.data?.find((project) => project.id === projectId) ?? projects.data?.[0];

  // The reviews in the order the list shows them: grouped by project.
  const activityRow = activity.data?.find((row) => row.id === activityId);
  const activityReview = reviewList.find((review) => review.id === activityRow?.reviewId);

  const ordered = (projects.data ?? []).flatMap((project) =>
    reviewList.filter((review) => review.projectId === project.id),
  );
  const moveReview = (step: 1 | -1) => {
    const index = ordered.findIndex((review) => review.id === selectedReview?.id);
    const next = ordered[Math.min(Math.max(index + step, 0), ordered.length - 1)];
    setSection("reviews");
    if (next) setReviewId(next.id);
  };
  const [showingShortcuts, setShowingShortcuts] = useState(false);
  useShortcuts({
    "alt+ArrowDown": () => moveReview(1),
    "alt+ArrowUp": () => moveReview(-1),
    "mod+b": () => {
      setSection("reviews");
      reviewsList.setCollapsed(section === "reviews" && !reviewsList.collapsed);
    },
    "?": () => setShowingShortcuts(true),
  });

  const loadError = projects.isError
    ? `Could not load projects: ${projects.error.message}`
    : reviews.isError
      ? `Could not load reviews: ${reviews.error.message}`
      : undefined;

  const reviewClosed = (note: string | null) =>
    dispatchToast(
      <Toast>
        <ToastTitle>Review closed</ToastTitle>
        {note && <ToastBody>{note}</ToastBody>}
      </Toast>,
      { intent: "success" },
    );

  return (
    <div
      className={mergeClasses(
        styles.shell,
        section === "reviews" && reviewsList.collapsed && styles.listCollapsed,
      )}
    >
      <TitleBar
        onShortcuts={() => setShowingShortcuts(true)}
        onOpen={(target) => {
          setSection("reviews");
          setReviewId(target.reviewId);
          setFocus({ ...target });
        }}
      />
      <AppRail selected={section} onSelect={setSection} badges={{ activity: unread }} />
      {section === "activity" ? (
        <>
          <ErrorBoundary what="Activity" className={styles.listArea}>
            <Suspense fallback={<LoadingRows label="Loading activity" />}>
              <ActivityPane
                selectedId={activityRow?.id}
                onOpen={(row) => {
                  setActivityId(row.id);
                  setReviewId(row.reviewId);
                  setFocus(activityTarget(row));
                }}
              />
            </Suspense>
          </ErrorBoundary>
          {activityReview ? (
            <ErrorBoundary
              resetKey={activityReview.id}
              what="This review"
              className={styles.mainArea}
            >
              <MainPane review={activityReview} focus={focus} onClosed={reviewClosed} />
            </ErrorBoundary>
          ) : (
            <div className={styles.placeholder}>
              <Text>Choose an activity to see its review.</Text>
            </div>
          )}
        </>
      ) : section === "projects" ? (
        <>
          <ErrorBoundary what="The project list" className={styles.listArea}>
            <Suspense fallback={<LoadingRows label="Loading projects" />}>
              <ProjectsPane selectedId={selectedProject?.id} onSelect={setProjectId} />
            </Suspense>
          </ErrorBoundary>
          <ErrorBoundary
            resetKey={selectedProject?.id}
            what="This project"
            className={styles.mainArea}
          >
            <Suspense fallback={null}>
              <ProjectDetail project={selectedProject} onRemoved={() => setProjectId(undefined)} />
            </Suspense>
          </ErrorBoundary>
        </>
      ) : section === "settings" ? (
        <ErrorBoundary what="Settings" className={styles.wideArea}>
          <Suspense fallback={null}>
            <SettingsPage />
          </Suspense>
        </ErrorBoundary>
      ) : (
        <>
          <ErrorBoundary what="The review list" className={styles.listArea}>
            <ListPane
              projects={projects.data}
              error={loadError}
              reviews={reviewList}
              selectedId={selectedReview?.id}
              onSelect={setReviewId}
              onAddProject={() => setSection("projects")}
              onNewReview={() => setCreating(true)}
              collapsed={reviewsList.collapsed}
              onCollapsedChange={reviewsList.setCollapsed}
            />
          </ErrorBoundary>
          <ErrorBoundary
            resetKey={selectedReview?.id}
            what="This review"
            className={styles.mainArea}
          >
            <MainPane
              review={selectedReview}
              focus={focus}
              onClosed={reviewClosed}
              onNewReview={projects.data?.length ? () => setCreating(true) : undefined}
            />
          </ErrorBoundary>
        </>
      )}
      {creating && projects.data && (
        <NewReviewDialog
          open
          projects={projects.data}
          initialProjectId={selectedReview?.projectId ?? selectedProject?.id}
          onClose={() => setCreating(false)}
          onCreated={(review) => {
            setCreating(false);
            setReviewId(review.id);
          }}
        />
      )}
      <ShortcutsDialog open={showingShortcuts} onOpenChange={setShowingShortcuts} />
      <Toaster toasterId={toasterId} position="bottom-end" />
    </div>
  );
}
