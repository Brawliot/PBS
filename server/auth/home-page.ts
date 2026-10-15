/**
 * The home page with its header already in the right state: the server reads the session cookie and writes the
 * signed-in user into the HTML, so the first paint needs no script. The page's own script then only checks the
 * session again (script.js). Pure: the markup goes in, the markup comes out; server.ts reads the session.
 *
 * Everything the user typed (the name) is escaped before it reaches the page. The page keeps no inline script
 * (the Content-Security-Policy), so the data travels in attributes only.
 */

export interface HomeUser {
  name: string;
}

/** Escapes text for an HTML attribute or text node */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The avatar letter: the first character of the name, upper case (as script.js shows it) */
export function initialOf(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?";
}

/** Replaces a fragment that must be in the page exactly once: a changed page fails here, not in the browser */
function replaceOnce(html: string, from: string, to: string): string {
  if (html.split(from).length !== 2) throw new Error(`home page: "${from}" must appear exactly once`);
  return html.replace(from, () => to);
}

/**
 * The page for a visitor: `user` is the signed-in person, or undefined for a guest. The guest block is shown for a
 * guest and the profile block for a signed-in person; the other stays hidden, as index.html has them.
 */
export function renderHome(html: string, user: HomeUser | undefined): string {
  if (!user) {
    return replaceOnce(html, '<div class="nav__guest" id="nav-guest" hidden>', '<div class="nav__guest" id="nav-guest">');
  }
  let page = replaceOnce(html, '<div class="nav__user" id="nav-user" hidden>', '<div class="nav__user" id="nav-user">');
  page = replaceOnce(page, 'aria-label="Your profile">?</button>', `aria-label="Your profile">${escapeHtml(initialOf(user.name))}</button>`);
  // JSON keeps the name intact; escapeHtml makes the JSON safe inside the attribute
  return replaceOnce(page, "<body>", `<body data-user="${escapeHtml(JSON.stringify({ name: user.name }))}">`);
}
