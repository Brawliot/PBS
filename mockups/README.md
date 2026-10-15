# Report mockups: three alternatives

Static design mockups of the pre-plan report (the card shown before "Build my plan").
They use the app's `styles.css` tokens, fonts and components, so light and dark mode follow the device as in the app.
No JavaScript: the folded blocks in A use `<details>`, and the route choice in C uses native radios.

Example case, the same in all three: "Bar de tapas en Malasaña, Madrid", €40,000 budget, takeover, looking for premises, 3 years in hospitality. All figures are invented and marked `estimated`.

Open them directly in a browser, e.g. `mockups/report-a-panel.html`.

## A. Panel: `report-a-panel.html`

- **Best for:** someone who wants the answer in five seconds and then decides whether to read more.
- **Does well:** the verdict and four large figures sit above the fold, and every detail is one tap away in folded blocks. Scans fastest on a phone.
- **Worse than B and C:** the explanation behind each number is thin, since the numbers are the message. It also gives no sense of choosing between routes.

## B. Story: `report-b-story.html`

- **Best for:** someone who is anxious about the decision and wants it explained, not just shown.
- **Does well:** reads like a letter from an advisor. Few figures, each one explained in the sentence around it, and a clear next step at the end. Its single column also works well on mobile.
- **Worse than A and C:** the slowest to scan, and the least useful for comparing numbers. It gives a verdict in one headline, but the figures sit deep in prose.

## C. Scenarios: `report-c-scenarios.html`

- **Best for:** someone who has not decided how to open yet (takeover, from scratch or franchise) and wants to compare before choosing.
- **Does well:** the three routes side by side, with the recommended one marked by a text badge and a thicker border, not by colour alone. The choice of route is a native radio group, so no JavaScript is needed.
- **Worse than A and B:** it is busier and assumes the user is weighing options. For someone who has already chosen a takeover, it spends space on two routes they will not take. On a phone the three cards stack into a long list.

## Notes for the comparison

- **Data consistency.** The brief's figures do not add up: the investment items, including a three-month cushion, do not reach €45–60k with the numbers given. I adjusted the items so they sum to €45–60k: takeover €20–25k, refurbishment €5–7k, equipment €5–6k, licences €2–3k, deposit €6–8k, cushion €7–11k. The "~€8,000 short" gap is measured against a "safe start" of €48k (low end of the range plus €3k margin), which is stated in the assumptions.
- **Break-even.** ~110 consumiciones a day is consistent with a €12 ticket, a 50% gross margin and 10 open hours: about 48 tickets, roughly €58–60 per open hour. These assumptions are shown on each page.
- **Checked.** Rendered in Chromium at 1280 px and 390 px, light and dark. No horizontal scroll at either width.
- **Not in the app.** These are static pages. Nothing here is wired into `index.html` or `script.js`.
