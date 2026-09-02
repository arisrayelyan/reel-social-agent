import React from 'react';
import { countFindings, sortFindings, type StoryFinding } from '@reel-agent/shared';
import { Card, SectionLabel } from '@/components/design';

/**
 * The story quality gate, read at the review desk.
 *
 * Laid out as a case-file margin rather than a stack of cards: a severity rule
 * down the left, a fixed mono gutter carrying the locator and the rule id, and
 * prose only in the third column. The producer scans the gutter, stops at a
 * colour, and reads one line — which is the actual job here.
 */

const SEVERITY = {
  error: { rule: 'var(--warn)', label: 'var(--warn)' },
  warning: { rule: 'var(--accent)', label: 'var(--accent)' },
} as const;

function locatorOf(finding: StoryFinding): string {
  return finding.beat_index === null
    ? 'story'
    : `beat ${String(finding.beat_index).padStart(2, '0')}`;
}

function FindingRow({ finding }: { finding: StoryFinding }) {
  const tone = SEVERITY[finding.severity];
  return (
    <li
      style={{
        display: 'flex',
        gap: 14,
        padding: '9px 0 9px 12px',
        borderLeft: `3px solid ${tone.rule}`,
        borderBottom: '1px solid var(--line)',
      }}
    >
      <div style={{ flex: '0 0 104px', fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.5 }}>
        <div style={{ color: tone.label }}>{locatorOf(finding)}</div>
        <div style={{ color: 'var(--text-3)', wordBreak: 'break-all' }}>{finding.rule}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text-1)', maxWidth: '62ch' }}>
          {finding.detail}
        </div>
        {finding.evidence ? (
          <div
            style={{
              marginTop: 4,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--text-2)',
              background: 'var(--bg-2)',
              border: '1px solid var(--line)',
              borderRadius: 3,
              padding: '2px 6px',
              display: 'inline-block',
              maxWidth: '100%',
              overflowWrap: 'anywhere',
            }}
          >
            {finding.evidence}
          </div>
        ) : null}
      </div>
    </li>
  );
}

const listReset: React.CSSProperties = { listStyle: 'none', margin: 0, padding: 0 };

export function StoryFindings({ findings }: { findings: StoryFinding[] }) {
  if (findings.length === 0) return null;

  const sorted = sortFindings(findings);
  const errors = sorted.filter((f) => f.severity === 'error');
  const warnings = sorted.filter((f) => f.severity === 'warning');
  const { errors: errorCount, warnings: warningCount } = countFindings(findings);

  return (
    <Card style={{ marginBottom: 16 }} data-testid="story-findings">
      <SectionLabel>Script check</SectionLabel>

      {errors.length > 0 && (
        <ul style={listReset} data-testid="finding-errors">
          {errors.map((finding, i) => (
            <FindingRow key={`${finding.rule}-${finding.beat_index}-${i}`} finding={finding} />
          ))}
        </ul>
      )}

      {warnings.length > 0 && (
        <details data-testid="finding-warnings" style={{ marginTop: errors.length > 0 ? 10 : 0 }}>
          <summary
            style={{
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: 'var(--accent)',
              padding: '4px 0',
            }}
          >
            {warningCount} worth a look
          </summary>
          <ul style={{ ...listReset, marginTop: 6 }}>
            {warnings.map((finding, i) => (
              <FindingRow key={`${finding.rule}-${finding.beat_index}-${i}`} finding={finding} />
            ))}
          </ul>
        </details>
      )}

      <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-3)', maxWidth: '62ch' }}>
        {errorCount > 0
          ? `${errorCount} ${errorCount === 1 ? 'rule' : 'rules'} the script breaks outright. Nothing here blocks the render — approve anyway, or request changes.`
          : 'Nothing here blocks the render. Approve, or request changes.'}
      </div>
    </Card>
  );
}
