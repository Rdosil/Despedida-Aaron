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
assert.match(document.querySelector('#wedding-vote-score').textContent, /1 cinema/i);

const bingoCell = document.querySelector('.wedding-bingo-cell');
bingoCell.click();
assert.equal(bingoCell.getAttribute('aria-pressed'), 'true');
assert.equal(JSON.parse(dom.window.localStorage.getItem('despedida-aaron-wedding-bingo')).length, 1);

console.log('wedding section ok');
