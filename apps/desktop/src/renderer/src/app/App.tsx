import {
  makeStyles,
  mergeClasses,
  Toast,
  ToastBody,
  Toaster,
  ToastTitle,
  useId,
  useToastController,
} from "@fluentui/react-components";
import { useState } from "react";
import { useLoadApprovals } from "../features/conversation/queries.ts";
import { useAppEvents } from "../features/conversation/useAppEvents.ts";
import { ProjectDetail } from "../features/projects/ProjectDetail.tsx";
import { ProjectsPane } from "../features/projects/ProjectsPane.tsx";
import { useProjects } from "../features/projects/queries.ts";
import { NewReviewDialog } from "../features/reviews/NewReviewDialog.tsx";
import { useReviews } from "../features/reviews/queries.ts";
import type { SearchTarget } from "../features/search/GlobalSearch.tsx";
import { SettingsPage } from "../features/settings/SettingsPage.tsx";
import { usePanel } from "../lib/panel.ts";
import { AppRail, type RailSection } from "./layout/AppRail.tsx";
import { ListPane } from "./layout/ListPane.tsx";
import { MainPane } from "./layout/MainPane.tsx";
import { TitleBar } from "./layout/TitleBar.tsx";

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
  const toasterId = useId("toaster");
  const { dispatchToast } = useToastController(toasterId);

  // Selections fall back to the first item, so a closed review or removed project never leaves a blank.
  const reviewList = reviews.data ?? [];
  const selectedReview = reviewList.find((review) => review.id === reviewId) ?? reviewList[0];
  const [projectId, setProjectId] = useState<string>();
  const selectedProject =
    projects.data?.find((project) => project.id === projectId) ?? projects.data?.[0];

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
        onOpen={(target) => {
          setSection("reviews");
          setReviewId(target.reviewId);
          setFocus({ ...target });
        }}
      />
      <AppRail selected={section} onSelect={setSection} />
      {section === "projects" ? (
        <>
          <ProjectsPane selectedId={selectedProject?.id} onSelect={setProjectId} />
          <ProjectDetail project={selectedProject} onRemoved={() => setProjectId(undefined)} />
        </>
      ) : section === "settings" ? (
        <SettingsPage />
      ) : (
        <>
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
          <MainPane review={selectedReview} focus={focus} onClosed={reviewClosed} />
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
      <Toaster toasterId={toasterId} position="bottom-end" />
    </div>
  );
}
