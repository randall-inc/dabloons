# Dabloons

## Testing

We don't write unit tests, integration tests, or any committed test code. Don't add test files, test folders, or test-runner dependencies. `scripts/no-tests.sh` enforces this in CI.

When a change needs proof it works, run a full end-to-end check against the real app (usually agent-driven: drive the CLI, site, or API like a user would) and keep an artifact that can't be faked, such as a screenshot or recording of the live result, real command output, or the resulting production record IDs. Attach that artifact to the PR.
