// Build-time feature flags (create-react-app inlines process.env.REACT_APP_*).

// AI citations are off until they can run against a fixed query set per site
// with repeated runs (two-score spec §8.3). Off hides the citations card and
// views, and the report download neither offers nor runs them. The code and
// the on-demand API route stay. Set REACT_APP_CITATIONS_ENABLED=true in an
// .env file to bring them back; S-03 and DL-03 to DL-05 need such a build.
export const CITATIONS_ENABLED = process.env.REACT_APP_CITATIONS_ENABLED === "true";
