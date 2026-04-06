import { ContentPillar, QueuePost } from './queue';

// CDT = UTC-5 (standard) / UTC-6 (daylight)
// We work in local server time and let toLocaleString handle display.

type TimeSlot = { hour: number; minute: number };

const PILLAR_WINDOWS: Record<ContentPillar, { days: number[]; slots: TimeSlot[] }> = {
  exercise: {
    days: [2, 4, 6], // Tue, Thu, Sat
    slots: [{ hour: 9, minute: 0 }, { hour: 18, minute: 0 }],
  },
  clinic_case: {
    days: [1, 3], // Mon, Wed
    slots: [{ hour: 12, minute: 0 }],
  },
  philosophy: {
    days: [3, 5], // Wed, Fri
    slots: [{ hour: 7, minute: 0 }],
  },
  story: {
    days: [0, 5], // Sun, Fri
    slots: [{ hour: 11, minute: 0 }, { hour: 18, minute: 0 }],
  },
};

const CONFLICT_BUFFER_MS = 2 * 60 * 60 * 1000; // ±2 hours

/**
 * Add a small random offset so the minute never ends in 0.
 * e.g. 9:00 → 9:07, 18:00 → 18:03, 12:00 → 12:11
 * Uses a seeded-ish offset based on the date so the same slot
 * always gets the same offset (stable across suggestions).
 */
function naturalizeMinutes(date: Date): Date {
  const result = new Date(date);
  const existing = result.getMinutes();
  if (existing % 10 !== 0) return result; // already natural
  // Pick a non-zero last digit: 1-9, biased away from 5 too (no :05, :15, :25...)
  const offsets = [3, 7, 11, 13, 17, 19, 23]; // prime-ish, all non-zero last digit
  const offset = offsets[result.getDate() % offsets.length];
  result.setMinutes(existing + offset);
  return result;
}

function hasConflict(candidate: Date, existing: QueuePost[]): boolean {
  return existing.some((post) => {
    if (post.status === 'rejected' || post.status === 'published') return false;
    const scheduled = new Date(post.scheduledTime);
    return Math.abs(candidate.getTime() - scheduled.getTime()) < CONFLICT_BUFFER_MS;
  });
}

/**
 * Returns 3 suggested posting times for the given pillar,
 * starting from tomorrow and scanning up to 21 days ahead.
 */
export function suggestScheduleTimes(pillar: ContentPillar, existingPosts: QueuePost[]): Date[] {
  const windows = PILLAR_WINDOWS[pillar];
  const suggestions: Date[] = [];

  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() + 1); // start tomorrow
  start.setHours(0, 0, 0, 0);

  for (let d = 0; d < 21 && suggestions.length < 3; d++) {
    const day = new Date(start);
    day.setDate(start.getDate() + d);
    const dayOfWeek = day.getDay(); // 0=Sun … 6=Sat

    if (!windows.days.includes(dayOfWeek)) continue;

    for (const slot of windows.slots) {
      if (suggestions.length >= 3) break;
      const candidate = new Date(day);
      candidate.setHours(slot.hour, slot.minute, 0, 0);
      if (candidate <= now) continue;
      if (!hasConflict(candidate, existingPosts)) {
        suggestions.push(naturalizeMinutes(candidate));
      }
    }
  }

  // Fall back to every other day at 9am if nothing matched
  if (suggestions.length === 0) {
    for (let d = 1; suggestions.length < 3; d += 2) {
      const fallback = new Date(now);
      fallback.setDate(now.getDate() + d);
      fallback.setHours(9, 0, 0, 0);
      if (!hasConflict(fallback, existingPosts)) suggestions.push(naturalizeMinutes(fallback));
    }
  }

  return suggestions;
}

export function formatSuggestion(date: Date): string {
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone: 'America/Chicago',
  });
}
