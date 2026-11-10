# Chrome Web Store listing

The text and answers to paste into the developer dashboard. The images come from `node store/assets.mjs` and land in `store/out`.

## Package

Upload `release/rote-<version>.zip` from `npm run package`. It has manifest.json at its root.

## Store listing tab

Summary comes from the manifest description.

Category: Productivity, Workflow and planning. Language: English.

Homepage URL: https://rote.walker-computers.com

Support URL: https://github.com/shin2344234/rote/issues

Images:

- Store icon: `store/out/icon-128.png`
- Screenshots, 1280 by 800: `store/out/screenshot-1-fill.png`, `store/out/screenshot-2-profile.png`
- Small promo tile, 440 by 280: `store/out/promo-small.png`
- Marquee promo tile, 1400 by 560: `store/out/promo-marquee.png`

Description:

```
Rote fills in job applications for you. Add your resume once, open an application on any site, and click Fill form. Rote types your name, contact details, work history and education into the form and attaches your resume.

How it works
1. Click the Rote icon, then Profile and logs. Add your resume as a PDF, Word file or text file. Rote reads it in your browser. Check what it found and fill in what a resume doesn't cover, like work authorization or start date.
2. Open a job application and click Scan page in the side panel.
3. Click Fill form. Green fields are confident matches. Amber ones need a second look. Undo clears what Rote filled.
4. Read the form and click submit yourself. Rote never submits an application.

What it won't do
- It never clicks submit and never touches a CAPTCHA.
- It never overwrites something you already typed without asking.
- It never stores or fills a Social Security number, date of birth or bank details.
- It does nothing on a page until you click Scan or Fill.
- Answers about work authorization, sponsorship, salary and EEO questions are filled but flagged, so you confirm them for each application.

Your data
Your resume, profile and saved answers stay in this browser. There's no account and no server holding them. When Rote fills a form, your details go to that job site, the same as typing them. Every few hours the panel asks GitHub for the newest release number so it can tell you when an update is out. That request holds nothing from your profile.

Optional AI help
AI is off by default. If you turn it on, Review missed sends your whole profile, saved answers and the unanswered questions to the provider you pick: Anthropic, OpenAI, OpenRouter, another provider, or a local model such as Ollama. Nothing goes out until you click the button. On Windows, a separate bridge lets Rote use Claude Code or Codex already installed on your PC.

Rote is free and open source: https://github.com/shin2344234/rote
```

## Privacy practices tab

Single purpose:

```
Rote fills job application forms with details from the user's own resume and profile, which it parses and stores in the browser.
```

Permission justifications:

scripting:
```
Rote injects its form reader into the active tab only when the user clicks Scan page or Fill form in the side panel. The script finds the application fields and fills them.
```

storage:
```
Stores the user's parsed profile, saved answers and settings in the browser so they are ready on the next application.
```

sidePanel:
```
The side panel is the main interface. It shows the scan results, the fill and undo buttons, and the list of fields the user still needs to check.
```

nativeMessaging:
```
Optional. If the user installs the separate bridge on Windows, Rote sends unanswered form questions to the Claude Code or Codex program on the user's own computer. Nothing is sent unless the user picks that connection and clicks Review missed.
```

Host permission:
```
Job applications are hosted on thousands of different domains, including company career sites and hiring platforms such as Workday, Greenhouse and Lever, and many embed the form in a frame from another domain. Rote needs access to any site so it can read and fill the form the user is looking at. It reads a page only when the user clicks Scan page or Fill form.
```

Remote code: No, I am not using remote code. Every script ships in the package. Calls to AI providers send and receive text only.

Data usage. Tick these, since each one can leave the browser at the user's request:

- Personally identifiable information. Filled into job sites, and sent to the AI provider the user picks when they click Review missed.
- Health information. Only a disability status the user chooses to enter for EEO questions. It goes to the same places.
- Authentication information. An API key the user enters goes only to the provider it belongs to.
- Web history. Bug reports, sent only when the user clicks Send report, include the addresses of pages Rote scanned, with query strings removed.
- Website content. Question text from the form goes to the AI provider on Review missed.

Then tick all three certifications. Rote sells no data, uses none of it for anything unrelated to filling applications, and does nothing with credit or lending.

Privacy policy URL: https://rote.walker-computers.com/privacy

## Distribution tab

Free, public, all regions.

## Test instructions for the reviewer

```
No account or login is needed. Click the Rote icon to open the side panel, click Profile and logs, and upload any resume (PDF, DOCX or TXT). Click Save profile. Then open any job application page, for example a Greenhouse or Lever job posting's application form, click Scan page and then Fill form in the side panel. AI review is off by default and needs the reviewer's own API key, so it can be skipped.
```
