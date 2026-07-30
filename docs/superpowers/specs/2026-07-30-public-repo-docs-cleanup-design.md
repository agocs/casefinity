# Documentation cleanup for going public

Date: 2026-07-30
Status: approved, ready to implement
Affects: repository root (new `README.md`, `LICENSE`, expanded `.gitignore`),
`docs/`, `CLAUDE.md`, `hardcase-gridfinity-generator/README.md`,
`hardcase-gridfinity-generator/scripts/build-spec.mjs`, `aps_f3d_to_step.py`

## Problem

`agocs/casefinity` is private and about to be made public. In its current state
that is not a repo a stranger can land in:

- **No root README.** A visitor sees eleven loose files and three oddly-named
  directories. The real documentation is one level down in
  `hardcase-gridfinity-generator/README.md` — 243 dense, good lines that mix
  user-facing print advice with developer architecture notes.
- **Four committed Claude memory files** — `MEMORY.md`,
  `hardcase-gridfinity-generator.md`, `perimeter-geometry.md`,
  `bin-double-sided.md`. They carry memory frontmatter, `originSessionId`s,
  machine notes ("Bazzite (immutable Fedora)"), harness quirks, personal
  references, and a note that an APS client secret was once pasted in chat.
  They duplicate the real memory directory. `MEMORY.md` indexes a
  `perimeter-template.md` that does not exist.
- **The creator's `.f3d` source files are tracked** — 4.5 MB across
  `1. Template/`, `2. Perimeter/`, `3. Bins/`, from the Unemployed Architect's
  Patreon-distributed Drive folder.
- **2.7 MB of duplicated STEP.** `step_output/` is byte-identical to
  `hardcase-gridfinity-generator/ground-truth/` (verified by md5sum). Two copies
  invite drift.
- **`.gitignore` is one line** (`__pycache__/`). No `.env`, no OS or editor junk.
- **No LICENSE**, so the default is all-rights-reserved.

No secrets are present in the code or in history: `aps_f3d_to_step.py` reads
`APS_CLIENT_ID` / `APS_CLIENT_SECRET` from the environment only.

## Decisions

Settled with the repo owner before implementation:

1. **`.f3d` originals: untrack going forward, keep history.** `git rm --cached`
   the three source directories and gitignore them; the files stay on disk. A
   history rewrite was offered and declined, so the files remain recoverable
   from the 62 existing commits. Recorded as a known residual below.
2. **Ground-truth STEP files stay tracked.** They are complete-geometry exports
   of the same Patreon designs, which carries a similar redistribution question
   to the `.f3d`s; the owner chose to keep them knowing that. They are load
   bearing — `npm run smoke` asserts against them.
3. **Root README is the front door**, carrying the whole story. The app README
   slims to developer detail. Long-form material moves into `docs/`.
4. **Deduplicate STEP** to `hardcase-gridfinity-generator/ground-truth/` as the
   single tracked copy; repoint `aps_f3d_to_step.py`'s `OUT_DIR` there so
   regeneration writes to the tracked location.
5. **MIT license on the code**, plus an explicit README "Design provenance"
   section drawing the boundary: the Gridfinity-for-Hardcases designs are the
   Unemployed Architect's work, this repo is an independent reimplementation,
   and generated STL/STEP output is subject to the original designer's terms.

### Deliberate non-change

`hardcase-gridfinity-generator/` is **not** renamed, despite the repo being
`casefinity` and the app being branded Casefinity. `wrangler.toml` lives inside
that directory and the Cloudflare build settings point at that path, so a
rename risks breaking the deploy for a cosmetic gain.

## Target layout

```
README.md                     NEW — front door
LICENSE                       NEW — MIT
.gitignore                    expanded
CLAUDE.md                     kept, paths updated
docs/
  models.md                   model catalog: porting status + fidelity, per-model
                              form options, intentional deviations, limitations
  printing.md                 print guide: bed-fitting, screw bosses, clearances,
                              export formats
  reverse-engineering.md      workflow, script reference, salvaged geometry findings
  casefinity-spec.md          moved from casefinity-liner-spec.md
  f3d-parameters.md           moved from f3d-extracted-parameters.md
  case-dimensions.md          salvaged from notes.md
  superpowers/                untouched historical specs + plans
hardcase-gridfinity-generator/
  README.md                   slimmed developer guide
  ground-truth/*.step         single tracked STEP copy
aps_f3d_to_step.py            OUT_DIR repointed to ground-truth/
```

### Where each existing file goes

| Current | Fate |
|---|---|
| `casefinity-liner-spec.md` | → `docs/casefinity-spec.md`, content unchanged |
| `f3d-extracted-parameters.md` | → `docs/f3d-parameters.md`, content unchanged |
| `all_options.md` | absorbed into `docs/models.md` |
| `notes.md` | → `docs/case-dimensions.md`, expanded with context |
| `MEMORY.md` | deleted (index of the memory files) |
| `hardcase-gridfinity-generator.md` | findings salvaged → `docs/reverse-engineering.md`, then deleted |
| `perimeter-geometry.md` | findings salvaged → `docs/reverse-engineering.md`, then deleted |
| `bin-double-sided.md` | findings salvaged → `docs/reverse-engineering.md`, then deleted |
| `step_output/` | untracked and deleted; `ground-truth/` is the copy |
| `1. Template/`, `2. Perimeter/`, `3. Bins/` | untracked, gitignored, kept on disk |
| app `README.md` | split: user material → `docs/`, dev material stays |

Salvage means the *technical* content only — geometry findings, OCCT traps,
recovered parameter values. Session IDs, machine notes, personal references and
the stale secret note are dropped.

## Content plan

**Root `README.md`** — what Casefinity is and who it is for; link to the live
site; the model list; quickstart (`npm install`, `npm run dev`); repo map;
"Design provenance" (attribution to the Unemployed Architect, link to the
Patreon, the boundary between his designs and this code, and what the MIT
license does and does not cover); pointers into `docs/`; contributing and
contact.

**`docs/models.md`** — one section per model, merging the app README's porting
table with `all_options.md`'s form layout so a model's fidelity and its
parameters are described in one place. Retains the "Intentional deviations"
discussion (3 mm wall / 4 mm floor vs the source's 1.2/1; 3 mm grid bump vs
1.2) and the known limitations.

**`docs/printing.md`** — the user-facing half currently buried in the app
README: fitting the perimeter to a printer bed, the screw-boss feature with its
REMFORM hole-sizing rationale and its three caveats, print clearances, and what
each export format is good for.

**`docs/reverse-engineering.md`** — the five-step workflow, the script
reference, the OCCT traps, and the salvaged per-model geometry findings.

**App `README.md`** — commands, architecture walkthrough, script reference,
deploy notes, and links to `docs/`.

## Verification

The docs move is only correct if nothing that reads these paths breaks:

- `npm run build-spec` must still emit `public/casefinity-spec.html` — its
  source path changes from `../../casefinity-liner-spec.md` to
  `../../docs/casefinity-spec.md`.
- `npm run build` (tsc + vite) and `npm run smoke` must stay green; smoke reads
  `ground-truth/`, which does not move.
- `git status` must show the `.f3d` directories as ignored, not deleted, and the
  files must still be present on disk.
- Every relative link in the new docs must resolve. Checked by extracting all
  markdown links and testing each target exists.
- No remaining reference to a moved or deleted path anywhere in tracked files
  (grep for `all_options`, `casefinity-liner-spec`, `f3d-extracted-parameters`,
  `step_output`, `notes.md`).

## Known residuals

- **The `.f3d` files and the memory files remain in git history.** Untracking
  affects only future commits; `git log` still reaches them once the repo is
  public. A `git-filter-repo` purge plus force-push to the five remote branches
  remains available if the owner later wants it.
- Licensing of the underlying designs is still unresolved with the creator. The
  README states the boundary rather than resolving it.
