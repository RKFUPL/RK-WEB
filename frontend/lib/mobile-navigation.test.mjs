import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(new URL('../components/home/sticky-header.tsx', import.meta.url), 'utf8');
const drawerStart = header.indexOf('className="absolute right-0 top-0 h-[100dvh]');
const drawerEnd = header.indexOf('</motion.aside>', drawerStart);
const mobileDrawer = header.slice(drawerStart, drawerEnd);

test('mobile navigation has one ordered Collections entry with its existing submenu', () => {
  assert.notEqual(drawerStart, -1);
  assert.notEqual(drawerEnd, -1);
  assert.equal((mobileDrawer.match(/>\s*Collections\s*<\/Link>/g) || []).length, 1);
  assert.match(mobileDrawer, /aria-label="Toggle collections"/);
  assert.match(mobileDrawer, /onClick=\{\(\) => \{ loadCollectionLinks\(\); setCollectionsOpen/);
  assert.match(mobileDrawer, /collectionLinks\.map\(\(collection\)/);

  const labels = [
    mobileDrawer.indexOf('>Home</span>'),
    mobileDrawer.search(/>\s*Collections\s*<\/Link>/),
    mobileDrawer.indexOf('>Shop</span>'),
    mobileDrawer.indexOf('>Lookbook</span>'),
    mobileDrawer.indexOf('>Runway</span>'),
    mobileDrawer.indexOf('>About</span>'),
    mobileDrawer.indexOf('>Contact</span>'),
  ];
  assert.ok(labels.every((index) => index >= 0));
  assert.deepEqual(labels, [...labels].sort((left, right) => left - right));
});

test('desktop navigation retains its Collections link', () => {
  const desktopStart = header.indexOf('<nav className="hidden items-center gap-9 lg:flex">');
  const desktopEnd = header.indexOf('</nav>', desktopStart);
  assert.notEqual(desktopStart, -1);
  assert.match(header.slice(desktopStart, desktopEnd), /href="\/collections"[\s\S]*?Collections/);
});
