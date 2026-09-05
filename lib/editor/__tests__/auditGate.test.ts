import { describe, it, expect } from 'vitest';
import { decideAuditGate, GATE } from '../auditGate';

const whisperOk = { overallStatus: 'clean' as const, structuralOk: true, meanDriftMs: 120, maxDriftMs: 300 };

describe('decideAuditGate', () => {
  it('passes on clean Deepgram numbers even when whisper says fail', () => {
    const d = decideAuditGate({
      deepgram: { maxDriftMs: 120, meanDriftMs: 40, matchedCount: 95, captionCount: 100 },
      whisper: { ...whisperOk, overallStatus: 'fail', meanDriftMs: 300, maxDriftMs: 1250 },
    });
    expect(d.verdict).toBe('pass');
    expect(d.by).toBe('deepgram');
    expect(d.reason).toMatch(/overruled/);
  });

  it('fails on Deepgram max, mean, or match-ratio breaches', () => {
    expect(decideAuditGate({ deepgram: { maxDriftMs: GATE.DG_MAX_MS + 1, meanDriftMs: 40, matchedCount: 100, captionCount: 100 }, whisper: whisperOk }).verdict).toBe('fail');
    expect(decideAuditGate({ deepgram: { maxDriftMs: 100, meanDriftMs: GATE.DG_MEAN_MS + 1, matchedCount: 100, captionCount: 100 }, whisper: whisperOk }).verdict).toBe('fail');
    expect(decideAuditGate({ deepgram: { maxDriftMs: 100, meanDriftMs: 40, matchedCount: 80, captionCount: 100 }, whisper: whisperOk }).verdict).toBe('fail');
  });

  it('structural failures always fail', () => {
    const d = decideAuditGate({
      deepgram: { maxDriftMs: 10, meanDriftMs: 5, matchedCount: 100, captionCount: 100 },
      whisper: { ...whisperOk, structuralOk: false },
    });
    expect(d).toMatchObject({ verdict: 'fail', by: 'structural' });
  });

  it('falls back to whisper only when Deepgram is unavailable, on mean not max', () => {
    expect(decideAuditGate({ deepgram: null, whisper: { ...whisperOk, overallStatus: 'fail', meanDriftMs: 200, maxDriftMs: 1250 } }).verdict).toBe('pass');
    expect(decideAuditGate({ deepgram: null, whisper: { ...whisperOk, overallStatus: 'fail', meanDriftMs: 900 } }).verdict).toBe('fail');
    expect(decideAuditGate({ deepgram: null, whisper: whisperOk })).toMatchObject({ verdict: 'pass', by: 'whisper' });
  });
});
