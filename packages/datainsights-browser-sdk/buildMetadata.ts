import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface PackageJson {
  version: string;
}

function packageVersion(path: string): string {
  return (JSON.parse(readFileSync(path, 'utf8')) as PackageJson).version;
}

function rrwebSourceCommit(): string {
  if (process.env.DATAINSIGHTS_RRWEB_COMMIT) {
    return process.env.DATAINSIGHTS_RRWEB_COMMIT;
  }
  return execFileSync(
    'git',
    [
      'log',
      '-1',
      '--format=%H',
      '--',
      'packages/rrweb',
      'packages/record',
      'packages/rrweb-snapshot',
    ],
    { cwd: resolve(__dirname, '../..'), encoding: 'utf8' },
  ).trim();
}

export function dataInsightsBuildMetadata(): {
  sdkVersion: string;
  rrwebVersion: string;
  rrwebCommit: string;
} {
  return {
    sdkVersion: packageVersion(resolve(__dirname, 'package.json')),
    rrwebVersion: packageVersion(resolve(__dirname, '../rrweb/package.json')),
    rrwebCommit: rrwebSourceCommit(),
  };
}

export function dataInsightsBuildDefines(): Record<string, string> {
  const metadata = dataInsightsBuildMetadata();
  return {
    __DATAINSIGHTS_SDK_VERSION__: JSON.stringify(metadata.sdkVersion),
    __DATAINSIGHTS_RRWEB_VERSION__: JSON.stringify(metadata.rrwebVersion),
    __DATAINSIGHTS_RRWEB_COMMIT__: JSON.stringify(metadata.rrwebCommit),
  };
}
