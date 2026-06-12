# Thank you for being interested in contributing to webgpu-nodes!

## Workflow

We follow the standard fork-based workflow:

1. **Fork** this repository to your GitHub account.
2. **Clone** your fork locally.
3. **Create a new branch** for your change:
   `git checkout -b your-feature-name`
4. **Commit and push** your changes to your branch.
5. **Open a pull request** from your branch to the `main` branch of this repository.

### Stacked PRs

If you want to submit stacked PRs, we recommend [GitButler](https://gitbutler.com/).

In this case, make sure you have both `origin` and `upstream` remotes set up; this is easiest done by cloning the repo through GitButler from the very start. If you already have features on your fork of the repo that you want to push upstream, add upstream as a remote.

When setting up your project in GitButler, set your target branch to `upstream/main` and the remote to create branches to to `origin`.

### PRs guidance

Please keep your pull requests focused to feature or issue. Focused smaller changes are easier to review and faster to merge.

## Preparing

This is a monorepo, meaning the repo holds multiple packages. It requires the use of [Bun](https://bun.com/). You can [install Bun natively](https://bun.com/docs/installation), but we recommand installing it with a package manager.

`bun` commands run in the project's root directory will run on all sub-projects. You can checkout the code and install the dependencies with:

```sh
git clone https://github.com/glypse/webgpu-nodes.git
cd cli
bun i
```

## Generating changelogs

Here is the command to generate a change set:

```sh
# from root of project
bun changeset

# select package
# choose the level of change (patch, minor, major)
# write a summary like:
#   feat(mdsvex): enable .svx .md extensions by default
#   fix(vitest): add browser testing to vitest config
#   chore(cli): update addons dependencies
```

- Do not edit `**/*/CHANGELOG.md` manually.
