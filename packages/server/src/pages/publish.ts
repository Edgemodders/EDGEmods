// How publishing works, for modders. Publishing itself happens in VS Code (R5); this page explains it.

import { html, type Html } from '../html.js';
import { page, type PageContext } from './layout.js';

export function publishPage(ctx: PageContext): Html {
  const steps: [string, string][] = [
    ['Make your mod in REDcode', 'REDcode is the Cyberpunk 2077 editor for VS Code. Your project folder is your mod\'s source.'],
    ['Press Publish', 'The EDGEmods extension asks for the mod\'s name, a short description, pictures, its files and what it needs. You sign in with GitHub once.'],
    ['Your own repository', 'EDGEmods turns your project folder into a GitHub repository in your account and pushes it. You own it; EDGEmods hosts no mod files.'],
    ['Release when you are ready', 'Nothing is released by itself. Click Release, check the notes drafted from your changes, and the build makes the download.'],
    ['Checked, then listed', 'EDGEmods checks the release: its files, what they contain, and a malware scan. When the checks pass, your mod has its page here.'],
    ['Keep going', 'Edit and push with VS Code\'s Source Control as you like. Other modders can send you changes; you decide what goes in.'],
  ];
  return page(ctx, { title: 'Publish a mod', nav: 'publish', description: 'How to publish a Cyberpunk 2077 mod on EDGEmods from REDcode and VS Code.' }, html`<main class="wrap">
    <div class="pagehead"><div class="eyebrow">For modders</div><h1>Publish a <span>mod</span></h1>
      <p class="lede">Publishing happens in VS Code, from your REDcode project, in a few clicks. You need a GitHub account; you never have to visit GitHub.</p></div>
    <ol class="steps">${steps.map(([title, text], i) => html`<li class="panel"><span class="id">${String(i + 1).padStart(2, '0')}</span><h3>${title}</h3><p>${text}</p></li>`)}</ol>
    <p class="dim">The EDGEmods extension is not released yet. The <a href="https://edgemodders.github.io/EDGEmods/">developer docs</a> follow its progress.</p>
  </main>`);
}
