#!/usr/bin/env bun
// Prints or releases the unreleased changelog: every fragment under
// changelog/unreleased/, grouped by section as changelog/README.md describes.
//
//   bun tools/commits/changelog.ts                    print ## [Unreleased]
//   bun tools/commits/changelog.ts release VERSION    write the fragments into
//       releases/changelog/VERSION.md, rebuild releases/changelog/README.md,
//       delete the fragments and set package.json's version. Tagging stays
//       by hand.
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { join, resolve } from 'node:path';

import { SECTIONS, parseFragment, type Fragment } from './fragment';

const ROOT = resolve(import.meta.dir, '../..');
const DIR = join(ROOT, 'changelog/unreleased');
const RELEASES = join(ROOT, 'releases/changelog');
const PACKAGE = join(ROOT, 'package.json');
const REPO = 'https://github.com/odogono/demo-golf';

const HEADINGS: Record<Fragment['section'], string> = {
  added: 'Added',
  changed: 'Changed',
  fixed: 'Fixed',
  known: 'Known issues',
  removed: 'Removed'
};

const VERSION = /^\d+\.\d+\.\d+$/;

// One version's section, `## <title>` then a `###` heading per section that
// has entries. A breaking entry comes first in its section, marked.
export const renderSection = (title: string, fragments: Fragment[]): string => {
  const lines = [`## ${title}`];
  for (const section of SECTIONS) {
    const entries = fragments
      .filter(fragment => fragment.section === section)
      .sort((a, b) => Number(b.breaking) - Number(a.breaking));
    if (entries.length > 0) {
      lines.push('', `### ${HEADINGS[section]}`, '');
      for (const { breaking, entry } of entries) {
        const text = entry.replaceAll(/\n(?!\n)/g, '\n  ');
        lines.push(`- ${breaking ? '**Breaking.** ' : ''}${text}`);
      }
    }
  }
  return lines.join('\n');
};

// Orders versions newest first.
export const compareVersions = (a: string, b: string): number => {
  const [pa, pb] = [a, b].map(version => version.split('.').map(Number));
  for (let i = 0; i < 3; i++) {
    if (pa![i] !== pb![i]) {
      return pb![i]! - pa![i]!;
    }
  }
  return 0;
};

// A release's file: its section, then where to see its commits.
export const renderRelease = (
  version: string,
  date: string,
  previous: string | undefined,
  fragments: Fragment[]
): string => {
  const link = previous
    ? `${REPO}/compare/v${previous}...v${version}`
    : `${REPO}/commits/v${version}`;
  return `${renderSection(`[${version}] - ${date}`, fragments)}\n\n[${version}]: ${link}\n`;
};

// The index of releases, newest first, each with its date.
export const renderIndex = (
  releases: { date: string; version: string }[]
): string => {
  const lines = [
    '# Releases',
    '',
    'One file per release, written by `bun run changelog:release X.Y.Z` from the fragments in [`changelog/unreleased/`](../../changelog/). Unreleased changes: `bun run changelog`.',
    ''
  ];
  for (const { date, version } of [...releases].sort((a, b) =>
    compareVersions(a.version, b.version)
  )) {
    lines.push(`- [${version}](${version}.md) - ${date}`);
  }
  return `${lines.join('\n')}\n`;
};

const readReleases = (): { date: string; version: string }[] =>
  readdirSync(RELEASES)
    .map(name => name.replace(/\.md$/, ''))
    .filter(version => VERSION.test(version))
    .map(version => {
      const text = readFileSync(join(RELEASES, `${version}.md`), 'utf8');
      const date = / - (\d{4}-\d{2}-\d{2})$/m.exec(text)?.[1] ?? '';
      return { date, version };
    });

const readFragments = (): {
  failed: boolean;
  fragments: Fragment[];
  names: string[];
} => {
  const fragments: Fragment[] = [];
  const names = readdirSync(DIR)
    .filter(name => name.endsWith('.md'))
    .sort();
  let failed = false;
  for (const name of names) {
    const result = parseFragment(readFileSync(join(DIR, name), 'utf8'));
    if ('errors' in result) {
      failed = true;
      for (const error of result.errors) {
        console.error(`changelog/unreleased/${name}: ${error}`);
      }
    } else {
      fragments.push(result.fragment);
    }
  }
  return { failed, fragments, names };
};

if (import.meta.main) {
  const [mode, version] = process.argv.slice(2);
  const { failed, fragments, names } = readFragments();
  if (mode === undefined) {
    console.log(renderSection('[Unreleased]', fragments));
    process.exit(failed ? 1 : 0);
  }
  if (mode !== 'release' || !version || !VERSION.test(version)) {
    console.error('usage: bun tools/commits/changelog.ts [release X.Y.Z]');
    process.exit(2);
  }
  if (failed) {
    process.exit(1);
  }
  if (fragments.length === 0) {
    console.error(
      'changelog: changelog/unreleased/ has no fragments to release'
    );
    process.exit(1);
  }
  const file = join(RELEASES, `${version}.md`);
  if (existsSync(file)) {
    console.error(`changelog: releases/changelog/${version}.md already exists`);
    process.exit(1);
  }
  const releases = readReleases();
  const previous = releases
    .map(release => release.version)
    .sort(compareVersions)[0];
  if (previous && compareVersions(version, previous) >= 0) {
    console.error(`changelog: ${version} isn't newer than ${previous}`);
    process.exit(1);
  }
  const date = new Date().toISOString().slice(0, 10);
  writeFileSync(file, renderRelease(version, date, previous, fragments));
  writeFileSync(
    join(RELEASES, 'README.md'),
    renderIndex([...releases, { date, version }])
  );
  const pkg = readFileSync(PACKAGE, 'utf8');
  writeFileSync(
    PACKAGE,
    pkg.replace(/"version": "[^"]*"/, `"version": "${version}"`)
  );
  for (const name of names) {
    rmSync(join(DIR, name));
  }
  console.log(
    `Released ${version}: ${names.length} fragments into releases/changelog/${version}.md. Tag it with "git tag v${version}" once merged.`
  );
}
