import { createRoot } from "react-dom/client";
import SigmaTimelinePlugin from "@/components/TimelineSlicer";

const el = document.getElementById("root")!;
createRoot(el).render(<SigmaTimelinePlugin />);
