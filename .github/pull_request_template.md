## What / why

## Test evidence

- [ ] `npm run build`
- [ ] `npm test` (build + smoke against `dist/`)
- [ ] `npm run license:check`

## Release checklist (R17: siblings change together)

- [ ] If manifests changed: README, CONTRIBUTING, and `repository.directory` updated in the same PR
- [ ] New source files carry the SPDX header (`CONTRIBUTING.md` has the snippet)
- [ ] No `workspace:` or `*` ranges in published dependencies
- [ ] Commits signed off (`git commit -s`, DCO)
