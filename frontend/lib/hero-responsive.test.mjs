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

test("shared homepage and runway banners use responsive media containers", () => {
  assert.match(featuredCollection, /homepage-featured-collection__viewport/);
  assert.match(featuredCollection, /homepage-featured-collection__frame object-cover/);
  assert.match(featuredLooks, /home-video-banner__media/);
  assert.match(runwayHero, /runway-hero-banner__media/);
  assert.match(css, /\.homepage-featured-collection__viewport,[\s\S]*?height: clamp\(36rem, 100svh, 64rem\)/);
  assert.match(css, /\.homepage-featured-collection__frame \{[\s\S]*?object-fit: cover/);
  assert.match(css, /\.home-video-banner__media,[\s\S]*?object-fit: cover/);
  assert.match(css, /\.runway-hero-banner__media \{[\s\S]*?object-position: center center/);
  assert.match(css, /\.runway-hero-banner__media[\s\S]*?object-fit: cover/);
});

test("banner sizing has deliberate mobile and tablet compositions", () => {
  assert.match(css, /@media \(min-width: 768px\) and \(max-width: 1023px\)/);
  assert.match(css, /\.collection-campaign-hero \{[\s\S]*?height: clamp\(38rem, 72svh, 48rem\)/);
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*?\.homepage-featured-collection__viewport,[\s\S]*?height: clamp\(30rem, 62svh, 36rem\)/);
  assert.match(featuredCollection, /mobilePosition: '85% center'/);
  assert.match(featuredCollection, /--hero-mobile-position': activeFrame\.mobilePosition/);
  assert.match(css, /object-position: var\(--hero-mobile-position, center center\)/);
  assert.match(crewSection, /aspect-\[16\/10\].*lg:aspect-\[3\/2\]/);
  assert.match(css, /\.collection-campaign-media \{[\s\S]*?object-fit: cover/);
  assert.match(css, /\.careers-page-hero \{[\s\S]*?background-size: 100% 100%, cover/);
  assert.match(careersPage, /className="careers-page-hero"/);
  assert.match(collectionHero, /window\.matchMedia\('\(max-width: 767px\)'\)/);
  assert.match(collectionHero, /const videoSource = isMobileViewport && hero\.mobileVideo \? hero\.mobileVideo : hero\.video/);
  assert.match(collectionHero, /key=\{videoSource\}/);
  assert.match(collectionHero, /onLoadedMetadata=\{\(event\) => void event\.currentTarget\.play\(\)\.catch/);
});
