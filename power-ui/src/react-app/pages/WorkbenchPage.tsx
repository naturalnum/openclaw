import { PowerWorkbenchHost } from "../workbench/PowerWorkbenchHost";

/**
 * Full-height route that renders the legacy Lit workbench inside the React shell.
 */
export function WorkbenchPage() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        height: "100%",
      }}
    >
      <PowerWorkbenchHost />
    </div>
  );
}
