import { makeStyles } from "@fluentui/react-components";
import { useMemo, useState } from "react";
import { ProjectDetail } from "../features/projects/ProjectDetail.tsx";
import { ProjectsPane } from "../features/projects/ProjectsPane.tsx";
import { useProjects } from "../features/projects/queries.ts";
import { placeholderReviewsFor } from "../features/reviews/placeholder.ts";
import { AppRail, type RailSection } from "./layout/AppRail.tsx";
import { ListPane } from "./layout/ListPane.tsx";
import { MainPane } from "./layout/MainPane.tsx";
import { TitleBar } from "./layout/TitleBar.tsx";

const useStyles = makeStyles({
  shell: {
    display: "grid",
    height: "100%",
    gridTemplateColumns: "68px 320px 1fr",
    gridTemplateRows: "48px 1fr",
    gridTemplateAreas: `"title title title" "rail list main"`,
  },
});

/** Teams-style shell: title bar, app rail, list pane, main pane. */
export function App() {
  const styles = useStyles();
  const [section, setSection] = useState<RailSection>("reviews");
  const projects = useProjects();
  const reviews = useMemo(() => placeholderReviewsFor(projects.data ?? []), [projects.data]);

  // Selections fall back to the first item, so a removed project or review never leaves a blank.
  const [reviewId, setReviewId] = useState<string>();
  const selectedReview = reviews.find((review) => review.id === reviewId) ?? reviews[0];
  const [projectId, setProjectId] = useState<string>();
  const selectedProject =
    projects.data?.find((project) => project.id === projectId) ?? projects.data?.[0];

  return (
    <div className={styles.shell}>
      <TitleBar />
      <AppRail selected={section} onSelect={setSection} />
      {section === "projects" ? (
        <>
          <ProjectsPane selectedId={selectedProject?.id} onSelect={setProjectId} />
          <ProjectDetail project={selectedProject} onRemoved={() => setProjectId(undefined)} />
        </>
      ) : (
        <>
          <ListPane
            projects={projects.data}
            error={projects.isError ? projects.error.message : undefined}
            reviews={reviews}
            selectedId={selectedReview?.id}
            onSelect={setReviewId}
            onAddProject={() => setSection("projects")}
          />
          <MainPane review={selectedReview} />
        </>
      )}
    </div>
  );
}
