# Design QA

- Source: user-provided desktop screenshot
- Implementation capture: local desktop QA capture (not committed)
- Side-by-side comparison: local QA artifact (not committed)
- Viewport: 1203 × 768
- State: existing project, completed AI file change, linked file open in read-only preview, project file panel expanded

## Full-view comparison

The existing light palette, compact desktop density, header height, rounded controls, and three-column rhythm are preserved. The new layout intentionally replaces the old settings-heavy right side with a real file tree, removes the top reminder strip and fixed creation controls, and gives the center chat the primary visual weight.

## Focused interaction comparison

The implementation capture also covers the highest-risk focused state: a conversation remains visible while a linked project file is previewed and the full file tree stays open. At the 1203-pixel viewport, the chat, preview, composer, and file panel remain readable with no overlap, clipping, or obscured controls.

## Findings and iteration

- First pass still showed three fixed prompt buttons in the empty conversation. They conflicted with the chat-first principle and were removed.
- The file panel collapses to a narrow rail and restores that preference after restarting the desktop app.
- A confirmed AI proposal immediately appeared as a new ordinary file in the tree, and the file opened in read-only preview without leaving the conversation.
- Internal project records did not appear in the file tree.
- No remaining material visual or interaction defects were found in the checked state.

final result: passed
