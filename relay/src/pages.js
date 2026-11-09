// The two pages the site serves. Plain strings keep the Worker free of a build step.
const shell = (title, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 system-ui, sans-serif; max-width: 42rem; margin: 0 auto; padding: 2rem 1rem 4rem; }
  h1 { font-size: 1.6rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.1rem; margin-top: 2rem; }
  nav { margin-bottom: 2rem; }
  nav a { margin-right: 1rem; }
</style>
</head>
<body>
<nav><a href="/">Rote</a><a href="/privacy">Privacy</a></nav>
${body}
</body>
</html>`;

export const HOME_PAGE = shell('Rote', `
<h1>Rote</h1>
<p>Rote is a Chrome extension that fills job applications from your resume. It reads the resume inside your browser, fills the form on whatever site you are applying through, and lists what it could not answer. It never clicks submit.</p>
<h2>Reporting a bug</h2>
<p>Open the extension, click Profile and logs, and use the Report a bug section. You see the whole report before it goes, and it holds no resume, no profile values and no saved answers.</p>
<p>This site receives those reports.</p>
<h2>Support Rote</h2>
<p>Rote is free and has no ads. If it helps you get hired, you can <a href="https://buymeacoffee.com/SethWalker234">buy me a coffee</a>.</p>
`);

export const PRIVACY_PAGE = shell('Rote privacy', `
<h1>Privacy</h1>
<p>Rote keeps your resume, your profile and your saved answers in your own browser. It has no account and no server of its own for that data.</p>
<h2>What leaves your browser</h2>
<p>Filling a form puts your details on the job site you are applying through, and attaching a resume uploads it to that site.</p>
<p>The AI review is off until you turn it on. When you click its button, your profile, your saved answers and the unanswered questions go to the AI provider you chose. A model running on your own computer keeps them there.</p>
<p>A bug report goes to this site only when you click Send report. It holds your description, the extension version, your browser version, the host name of the page, your AI connection type and model name, and the extension's log. The log records form field labels, field types and match scores. Values you typed or that came from your resume are removed before the report leaves your browser. A contact address is included only if you type one.</p>
<h2>What happens to a report</h2>
<p>Reports are stored in a private issue tracker that only the developer can read, and they are used to fix the problem you reported. To have a report deleted, send its report ID through a new report.</p>
<h2>What is never collected</h2>
<p>Rote has no analytics and no tracking. It does not store or fill Social Security numbers, dates of birth, passwords or bank details.</p>
`);

export const CONNECTED_PAGE = shell('Rote is connected', `
<h1>Rote is connected</h1>
<p>OpenRouter approved the sign-in. Rote closes this tab by itself, and you can close it if it stays open.</p>
`);
