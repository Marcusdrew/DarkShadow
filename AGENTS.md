# Architecture rules

- Keep mobile privacy protection browser-side, with a synchronous document-wide mask and explicit resumption after lifecycle interruptions; browser signals cannot prove or prevent OS captures.
- Keep shield resumption eligibility in a browser-safe pure policy with focused tests so background or unfocused documents cannot reveal conversations.