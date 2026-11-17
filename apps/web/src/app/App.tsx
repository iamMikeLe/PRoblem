import { makeStyles } from "@fluentui/react-components";
import { useState } from "react";
import { placeholderReviews } from "../features/reviews/placeholder.ts";
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
  const [selectedId, setSelectedId] = useState<string | undefined>(placeholderReviews[0]?.id);
  const selected = placeholderReviews.find((review) => review.id === selectedId);

  return (
    <div className={styles.shell}>
      <TitleBar />
      <AppRail selected={section} onSelect={setSection} />
      <ListPane reviews={placeholderReviews} selectedId={selectedId} onSelect={setSelectedId} />
      <MainPane review={selected} />
    </div>
  );
}
