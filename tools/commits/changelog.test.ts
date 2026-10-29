import { expect, test } from 'bun:test';

import {
  compareVersions,
  renderIndex,
  renderRelease,
  renderSection
} from './changelog';
import { type Fragment } from './fragment';

const entry = (fields: Partial<Fragment>): Fragment => ({
  breaking: false,
  entry: 'X.',
  section: 'added',
  type: 'feat',
  ...fields
});

test('groups entries by section in Keep a Changelog order, breaking first', () => {
  expect(
    renderSection('[Unreleased]', [
      entry({ entry: 'Fix y.', section: 'fixed', type: 'fix' }),
      entry({ entry: '**Add x.** Line one\nline two.' }),
      entry({ breaking: true, entry: 'Rename z.' }),
      entry({ entry: 'Still slow.', section: 'known', type: 'docs' })
    ])
  ).toBe(
    [
      '## [Unreleased]',
      '',
      '### Added',
      '',
      '- **Breaking.** Rename z.',
      '- **Add x.** Line one\n  line two.',
      '',
      '### Fixed',
      '',
      '- Fix y.',
      '',
      '### Known issues',
      '',
      '- Still slow.'
    ].join('\n')
  );
});

test('orders versions newest first, numerically', () => {
  expect(['0.2.0', '0.10.0', '0.9.1'].sort(compareVersions)).toEqual([
    '0.10.0',
    '0.9.1',
    '0.2.0'
  ]);
});

test('links a release to the compare view from the previous one', () => {
  expect(renderRelease('0.2.0', '2026-11-01', '0.1.0', [entry({})])).toBe(
    '## [0.2.0] - 2026-11-01\n\n### Added\n\n- X.\n\n[0.2.0]: https://github.com/odogono/demo-golf/compare/v0.1.0...v0.2.0\n'
  );
});

test('links the first release to its commits', () => {
  expect(
    renderRelease('0.1.0', '2026-11-01', undefined, [entry({})])
  ).toEndWith('[0.1.0]: https://github.com/odogono/demo-golf/commits/v0.1.0\n');
});

test('indexes releases newest first', () => {
  expect(
    renderIndex([
      { date: '2026-11-01', version: '0.1.0' },
      { date: '2026-12-01', version: '0.2.0' }
    ])
  ).toEndWith(
    '- [0.2.0](0.2.0.md) - 2026-12-01\n- [0.1.0](0.1.0.md) - 2026-11-01\n'
  );
});
