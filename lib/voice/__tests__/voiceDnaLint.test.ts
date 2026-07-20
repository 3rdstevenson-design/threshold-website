import { describe, expect, it } from 'vitest';
import {
  autoFixVoiceDna,
  lintAndAutoFix,
  lintVoiceDna,
  looksLikeMetaReply,
} from '../voiceDnaLint';

const CLEAN =
  "I rebuilt Marcus's serve from the ground up. His shoulder used to bark at every overhead, and now he plays full matches without thinking about it. The work took 3 months of specific loading, not guesswork.";

describe('lintVoiceDna', () => {
  it('passes clean first-person copy', () => {
    const r = lintVoiceDna(CLEAN);
    expect(r.violations.filter((v) => v.hard)).toHaveLength(0);
    expect(r.pass).toBe(true);
  });

  it('flags each banned phrase category', () => {
    const cases: Array<[string, string]> = [
      ['dead_ai_language', "It's important to note that I train hard."],
      ['dead_transitions', 'Furthermore, the shoulder improved.'],
      ['engagement_bait', 'Let that sink in.'],
      ['ai_cringe', 'This will supercharge your recovery process today.'],
      ['clinical_banned', 'I found the root cause of the problem here.'],
    ];
    for (const [category, text] of cases) {
      const r = lintVoiceDna(text);
      expect(r.pass, `${category} should fail: ${text}`).toBe(false);
      expect(r.violations.some((v) => v.category === category)).toBe(true);
    }
  });

  it('does not flag banned words inside larger words', () => {
    // "unlock" banned, "unlocked"/"padlock" not matched; "realm" vs "realms" boundary
    const r = lintVoiceDna('I unlocked the padlock on the gym door before dawn training.');
    expect(r.violations.filter((v) => v.category === 'ai_cringe')).toHaveLength(0);
  });

  it('flags the FATAL negation pattern variants', () => {
    const fatals = [
      "This isn't about strength. This is about control.",
      "It's not weakness. It's untrained capacity.",
      'Forget stretching. This is loading.',
      'Less mobility work, more strength work.',
    ];
    for (const text of fatals) {
      const r = lintVoiceDna(text);
      expect(
        r.violations.some((v) => v.category === 'fatal_negation_pattern'),
        `should flag: ${text}`,
      ).toBe(true);
    }
  });

  it('flags em dashes and exclamation points as autofixable', () => {
    const r = lintVoiceDna('Strong hips — strong serve. Get after it today with real intent.');
    const em = r.violations.find((v) => v.category === 'em_dash');
    expect(em?.autoFixable).toBe(true);

    const r2 = lintVoiceDna('I loved every second of that session and the next one too, honestly.');
    expect(r2.violations.filter((v) => v.category === 'exclamation')).toHaveLength(0);
    const r3 = lintVoiceDna('What a session that turned out to be for everyone involved today!');
    expect(r3.violations.some((v) => v.category === 'exclamation')).toBe(true);
  });

  it('flags first-person plural', () => {
    const r = lintVoiceDna("We're going to rebuild your squat pattern over the next month.");
    expect(r.violations.some((v) => v.category === 'we_pronoun')).toBe(true);
  });

  it('treats meta replies as hard failures', () => {
    const r = lintVoiceDna("I'm ready to audit the caption. Please paste the draft now.");
    expect(r.pass).toBe(false);
    expect(r.violations.some((v) => v.category === 'meta_reply')).toBe(true);
  });

  it('reports fragment-staccato as soft only', () => {
    const r = lintVoiceDna(
      'Train hard. Stay sharp. No excuses. That mindset carried him through nine months of rehab without a single missed session.',
    );
    const frag = r.violations.find((v) => v.category === 'fragment_staccato');
    expect(frag).toBeDefined();
    expect(frag?.hard).toBe(false);
    expect(r.pass).toBe(true);
  });
});

describe('autoFixVoiceDna', () => {
  it('replaces em dashes with commas', () => {
    expect(autoFixVoiceDna('Strong hips — strong serve.')).toBe('Strong hips, strong serve.');
  });

  it('replaces exclamation runs with a period', () => {
    expect(autoFixVoiceDna('Huge win!! Back at it tomorrow.')).toBe(
      'Huge win. Back at it tomorrow.',
    );
  });

  it('fixes unambiguous we-forms preserving capitalization', () => {
    expect(autoFixVoiceDna("We're testing again on Friday.")).toBe("I'm testing again on Friday.");
    expect(autoFixVoiceDna('Our plan held up.')).toBe('My plan held up.');
  });

  it('leaves "us" alone (context-dependent)', () => {
    expect(autoFixVoiceDna('The gym gave us space to test.')).toContain('us');
  });
});

describe('lintAndAutoFix', () => {
  it('mechanically repairs a fixable draft to passing', () => {
    const { text, result } = lintAndAutoFix(
      'Strong hips — strong serve. That single cue changed how he moved through the whole kinetic chain.',
    );
    expect(result.pass).toBe(true);
    expect(text).not.toContain('—');
  });

  it('cannot repair banned phrases, still fails', () => {
    const { result } = lintAndAutoFix(
      'I found the root cause of his knee pain during the second session.',
    );
    expect(result.pass).toBe(false);
  });
});

describe('looksLikeMetaReply', () => {
  it('detects conversational model replies', () => {
    expect(looksLikeMetaReply('Please provide the transcript so I can write the caption.')).toBe(
      true,
    );
    expect(looksLikeMetaReply(CLEAN)).toBe(false);
  });

  it('treats very short text as meta', () => {
    expect(looksLikeMetaReply('Sure.')).toBe(true);
  });
});
