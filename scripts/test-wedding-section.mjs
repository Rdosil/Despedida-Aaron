import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'https://example.test/', runScripts: 'outside-only' });
const { document } = dom.window;

const navLink = document.querySelector('nav a[href="#voda"]');
const section = document.querySelector('section#voda');
assert.ok(navLink, 'a navegación debe enlazar o apartado da voda');
assert.ok(section, 'debe existir o apartado #voda');
assert.match(section.textContent, /Aarón e Lucía/i);
assert.match(section.textContent, /5 de setembro de 2026/i);
assert.match(section.textContent, /Casa Anido/i);
assert.match(section.textContent, /picoteo/i);
assert.match(section.textContent, /barra libre/i);
assert.ok(html.indexOf('<!-- VODA -->') < html.indexOf('<!-- PALMARÉS -->'), 'o apartado da voda debe aparecer antes do palmarés');
assert.match(html, /<title>Aarón e Lucía · a voda<\/title>/);
assert.match(document.querySelector('.hero h1')?.textContent || '', /Aarón\s*e Lucía/i);
assert.match(document.querySelector('.count-lab')?.textContent || '', /voda/i);
const invitation = section.querySelector('img[src="assets/invitacion-aaron-lucia.jpg"]');
assert.ok(invitation, 'debe integrarse a invitación enviada polo usuario');
assert.equal(invitation.getAttribute('width'), '908');
assert.equal(invitation.getAttribute('height'), '1280');
assert.match(invitation.getAttribute('alt') || '', /Aarón e Lucía/i);
assert.match(html, /section\{[^}]*scroll-margin-top:/, 'as áncoras deben reservar o alto da navegación fixa');
assert.match(html, /nav\{[^}]*flex-wrap:nowrap/, 'a navegación móbil debe manter unha soa fila desprazable');

const start = html.indexOf('/* WEDDING_INLINE_START */');
const end = html.indexOf('/* WEDDING_INLINE_END */');
assert.ok(start >= 0 && end > start, 'debe existir o script interactivo da voda');
const script = html.slice(start, end);

dom.window.eval(script);

const missionOutput = document.querySelector('#wedding-mission-output');
const missionBefore = missionOutput.textContent;
document.querySelector('#wedding-mission-btn').click();
assert.notEqual(missionOutput.textContent, missionBefore, 'o xerador debe asignar unha misión');

const cinemaButton = document.querySelector('[data-wedding-vote="cinema"]');
cinemaButton.click();
assert.match(document.querySelector('#wedding-vote-score').textContent, /1 Xenialidade/i);

const bingoCell = document.querySelector('.wedding-bingo-cell');
bingoCell.click();
assert.equal(bingoCell.getAttribute('aria-pressed'), 'true');
assert.equal(JSON.parse(dom.window.localStorage.getItem('despedida-aaron-wedding-bingo')).length, 1);

console.log('wedding section ok');
