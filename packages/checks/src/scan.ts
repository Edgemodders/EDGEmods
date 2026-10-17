// Malware scanning, behind an interface so the scanner can change (ClamAV now; VirusTotal is an open question).

import { execFile } from 'node:child_process';

export interface ScanResult {
  clean: boolean;
  /** What was found, in the scanner's words, such as "Win.Trojan.Agent-123". */
  findings: string[];
}

export interface Scanner {
  name: string;
  scan(file: string): Promise<ScanResult>;
}

export class ScannerUnavailable extends Error {}

/**
 * ClamAV's command-line scanner. It looks inside zip and 7z files itself. The signature database must be fresh:
 * the workflow runs freshclam first. Exit codes: 0 clean, 1 found, 2 error.
 */
export function clamav(tool = 'clamscan'): Scanner {
  return {
    name: 'ClamAV',
    scan: (file) =>
      new Promise((resolve, reject) => {
        execFile(
          tool,
          ['--no-summary', '--infected', '--scan-archive=yes', '--alert-encrypted=yes', '--max-filesize=2000M', '--max-scansize=4000M', '--', file],
          { maxBuffer: 16 * 1024 ** 2 },
          (err, stdout) => {
            // A missing tool reports code 'ENOENT'; a finished scan reports its exit code as a number.
            const code: number | string | undefined = err ? (err as { code?: number | string }).code : 0;
            if (code === 'ENOENT') return reject(new ScannerUnavailable('ClamAV is not installed.'));
            const findings = stdout
              .split(/\r?\n/)
              .map((line) => /: (.+) FOUND$/.exec(line)?.[1])
              .filter((f): f is string => Boolean(f));
            if (code === 0) resolve({ clean: true, findings: [] });
            else if (code === 1) resolve({ clean: false, findings: findings.length ? findings : ['unnamed finding'] });
            else reject(new ScannerUnavailable(`ClamAV could not scan the file (exit ${String(code)}).`));
          },
        );
      }),
  };
}
