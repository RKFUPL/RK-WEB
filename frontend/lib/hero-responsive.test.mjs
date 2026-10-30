import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const featuredCollection = readFileSync(new URL("../components/home/featured-collection.tsx", import.meta.url), "utf8");
const featuredLooks = readFileSync(new URL("../components/home/featured-looks.tsx", import.meta.url), "utf8");
const runwayHero = readFileSync(new URL("../components/runway-hero.tsx", import.meta.url), "utf8");
const collectionHero = readFileSync(new URL("../components/collections/collection-hero.tsx", import.meta.url), "utf8");
const careersPage = readFileSync(new URL("../app/careers/page.tsx", import.meta.url), "utf8");
const crewSection = readFileSync(new URL("../components/home/newsletter.tsx", import.meta.url), "utf8");

test("homepage image and video media use their intrinsic aspect ratio at full width", () => {
  assert.match(featuredCollection, /homepage-featured-collection__viewport relative grid w-full overflow-hidden/);
  assert.match(featuredCollection, /className="col-start-1 row-start-1 relative w-full overflow-hidden"/);
  assert.match(featuredCollection, /width=\{1920\}[\s\S]*?height=\{1080\}[\s\S]*?className="homepage-featured-collection__frame block h-auto w-full"/);
  assert.match(featuredLooks, /home-video-banner__media/);
  assert.match(featuredLooks, /width=\{1920\}[\s\S]*?height=\{1080\}[\s\S]*?className="home-video-banner__media block h-auto w-full"/);
  assert.doesNotMatch(featuredLooks, /object-cover|object-contain|absolute inset-0 h-full w-full/);
  assert.doesNotMatch(css, /\.homepage-featured-collection__viewport,[\s\S]*?height: clamp/);
  assert.doesNotMatch(css, /\.homepage-featured-collection__frame[\s\S]*?object-fit/);
  assert.doesNotMatch(css, /\.home-video-banner,[\s\S]*?height: clamp/);
  assert.doesNotMatch(css, /\.home-video-banner__media[\s\S]*?object-fit/);
  assert.match(runwayHero, /runway-hero-banner__media/);
  assert.match(css, /\.runway-hero-banner \{[\s\S]*?height: clamp\(36rem, 100svh, 64rem\)/);
  assert.match(css, /\.runway-hero-banner__media \{[\s\S]*?object-position: center center/);
  assert.match(css, /\.runway-hero-banner__media[\s\S]*?object-fit: cover/);
});

test("banner sizing has deliberate mobile and tablet compositions", () => {
  assert.match(css, /@media \(min-width: 768px\) and \(max-width: 1023px\)/);
  assert.match(css, /\.collection-campaign-hero \{[\s\S]*?height: clamp\(38rem, 72svh, 48rem\)/);
  assert.match(featuredCollection, /window\.matchMedia\('\(max-width: 767px\)'\)/);
  assert.match(css, /\.homepage-featured-collection__copy \{[\s\S]*?bottom: 1\.9rem/);
  assert.match(crewSection, /grid grid-cols-\[minmax\(0,1fr\)_minmax\(0,1fr\)\] items-center/);
  assert.match(crewSection, /width=\{1920\} height=\{1080\} sizes=/);
  assert.match(crewSection, /className="block h-auto w-full"/);
  assert.doesNotMatch(crewSection, /aspect-\[16\/10\]|object-cover/);
  assert.match(css, /\.collection-campaign-media \{[\s\S]*?object-fit: cover/);
  assert.match(css, /\.careers-page-hero \{[\s\S]*?background-size: 100% 100%, cover/);
  assert.match(careersPage, /className="careers-page-hero"/);
  assert.match(collectionHero, /window\.matchMedia\('\(max-width: 767px\)'\)/);
  assert.match(collectionHero, /const videoSource = isMobileViewport && hero\.mobileVideo \? hero\.mobileVideo : hero\.video/);
  assert.match(collectionHero, /key=\{videoSource\}/);
  assert.match(collectionHero, /onLoadedMetadata=\{\(event\) => void event\.currentTarget\.play\(\)\.catch/);
});
