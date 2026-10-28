// semantic-release: version from Conventional Commits and a GitHub release
// with notes. No commit is pushed back: the version lives in the tag.
module.exports = {
  branches: ["main"],
  plugins: [
    ["@semantic-release/commit-analyzer", { preset: "conventionalcommits" }],
    ["@semantic-release/release-notes-generator", { preset: "conventionalcommits" }],
    // A failed release shows in the Actions run; no tracking issue needed.
    ["@semantic-release/github", { failComment: false, failTitle: false, successComment: false }],
  ],
};
