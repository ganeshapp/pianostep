import { describe, expect, it } from 'vitest';
import {
  buildTempoMap,
  noTempoWarning,
  openingTempoWarning,
  secondsToTick,
  tickToSeconds,
  unrollMeasures,
} from '../src/core/model/performance';
import { ScoreBuilder, measureIndexes } from './helpers/sourceBuilder';

function mapOf(b: ScoreBuilder) {
  const s = b.build();
  const { occurrences } = unrollMeasures(s);
  return { map: buildTempoMap(s, occurrences), occurrences };
}

describe('buildTempoMap', () => {
  it('defaults to 120 quarter notes per minute when the file has no tempo', () => {
    const { map } = mapOf(new ScoreBuilder().measures(2));
    expect(map).toEqual({ ticksPerQuarter: 4, points: [{ tick: 0, qpm: 120 }], defaulted: true });
    expect(noTempoWarning()).toEqual({
      code: 'no-tempo-in-file',
      severity: 'info',
      message: 'The file does not give a tempo, so the app chose 120 quarter notes per minute.',
      count: 1,
    });
  });

  it('a first tempo later in the first measure also applies from the start', () => {
    const b = new ScoreBuilder().measures(2).tempo(0, 2, 80);
    const { map } = mapOf(b);
    expect(map).toEqual({ ticksPerQuarter: 4, points: [{ tick: 0, qpm: 80 }], defaulted: false });
    expect(openingTempoWarning(b.build())).toBeNull();
  });

  it('a first tempo in the first full measure after a pickup also applies from the pickup', () => {
    const implicit = new ScoreBuilder()
      .measure({ number: '0', implicit: true, durationTicks: 4 })
      .measures(2)
      .tempo(1, 1, 80);
    expect(mapOf(implicit).map.points).toEqual([{ tick: 0, qpm: 80 }]);
    expect(openingTempoWarning(implicit.build())).toBeNull();
    // Some files leave the implicit flag out: a first measure shorter than its time signature is a pickup too.
    const short = new ScoreBuilder().measure({ time: [3, 4], durationTicks: 4 }).measures(2).tempo(1, 0, 80);
    expect(mapOf(short).map.points).toEqual([{ tick: 0, qpm: 80 }]);
    expect(openingTempoWarning(short.build())).toBeNull();
  });

  it('a first tempo mark further in leaves the opening at the default 120 until the mark, and says so', () => {
    const b = new ScoreBuilder().measures(4).tempo(2, 0, 80);
    const { map } = mapOf(b);
    expect(map).toEqual({
      ticksPerQuarter: 4,
      points: [
        { tick: 0, qpm: 120 },
        { tick: 32, qpm: 80 },
      ],
      defaulted: false,
    });
    // Measures 1-2 last 8 quarters at 120 = 4 s; measure 3 is 4 quarters at 80 = 3 s.
    expect(tickToSeconds(map, 32)).toBeCloseTo(4, 12);
    expect(tickToSeconds(map, 48) - tickToSeconds(map, 32)).toBeCloseTo(3, 12);
    expect(openingTempoWarning(b.build())).toEqual({
      code: 'opening-tempo-defaulted',
      severity: 'info',
      message:
        'The opening has no tempo mark, so the app plays it at 120 quarter notes per minute until the first marked tempo (measure 3).',
      count: 1,
    });
  });

  it('the second measure is not near the start unless the first is a pickup', () => {
    const { map } = mapOf(new ScoreBuilder().measures(2).tempo(1, 2, 80));
    expect(map.points).toEqual([
      { tick: 0, qpm: 120 },
      { tick: 24, qpm: 80 },
    ]);
  });

  it('a repeat back to the unmarked opening plays it at the default tempo again', () => {
    // |: 1 | 2 (Presto 160) :| 3
    const { map, occurrences } = mapOf(
      new ScoreBuilder().measure({ forward: true }).measure().measure({ backward: true }).measure().tempo(2, 0, 160),
    );
    expect(measureIndexes(occurrences)).toEqual([0, 1, 2, 0, 1, 2, 3]);
    expect(map.points).toEqual([
      { tick: 0, qpm: 120 },
      { tick: 32, qpm: 160 },
      { tick: 48, qpm: 120 },
      { tick: 80, qpm: 160 },
    ]);
  });

  it('a file with no tempo at all gets the no-tempo note, not the opening note', () => {
    expect(openingTempoWarning(new ScoreBuilder().measures(2).build())).toBeNull();
  });

  it('places a mid-measure tempo change at the right performance tick', () => {
    const { map } = mapOf(new ScoreBuilder().measures(2).tempo(0, 0, 100).tempo(1, 1.5, 90));
    expect(map.points).toEqual([
      { tick: 0, qpm: 100 },
      { tick: 22, qpm: 90 },
    ]);
  });

  it('a tempo inside a repeated measure applies on each occurrence', () => {
    const { map, occurrences } = mapOf(
      new ScoreBuilder()
        .measure({ forward: true })
        .measure({ backward: true })
        .measure()
        .tempo(0, 0, 100)
        .tempo(1, 2, 60),
    );
    expect(measureIndexes(occurrences)).toEqual([0, 1, 0, 1, 2]);
    expect(map.points).toEqual([
      { tick: 0, qpm: 100 },
      { tick: 24, qpm: 60 },
      { tick: 32, qpm: 100 },
      { tick: 56, qpm: 60 },
    ]);
    expect(map.defaulted).toBe(false);
  });

  it('after a jump the music resumes at the tempo written for that spot', () => {
    const { map, occurrences } = mapOf(
      new ScoreBuilder()
        .measure()
        .measure({ segno: true })
        .measure()
        .measure({ dalSegno: true })
        .tempo(0, 0, 100)
        .tempo(2, 0, 50),
    );
    expect(measureIndexes(occurrences)).toEqual([0, 1, 2, 3, 1, 2, 3]);
    expect(map.points).toEqual([
      { tick: 0, qpm: 100 },
      { tick: 32, qpm: 50 },
      { tick: 64, qpm: 100 },
      { tick: 80, qpm: 50 },
    ]);
  });

  it('a mid-measure tempo inside a repeat lands at its offset in every pass', () => {
    const { map } = mapOf(
      new ScoreBuilder(48)
        .measure({ time: [3, 4] })
        .measure({ backward: true })
        .tempo(0, 0, 72)
        .tempo(1, 1, 144),
    );
    // Bars are 144 ticks; the change is 48 ticks into measure 2 on each pass.
    expect(map.points).toEqual([
      { tick: 0, qpm: 72 },
      { tick: 192, qpm: 144 },
      { tick: 288, qpm: 72 },
      { tick: 480, qpm: 144 },
    ]);
  });

  it('later marks at the same tick win and repeated values are collapsed', () => {
    const { map } = mapOf(new ScoreBuilder().measures(2).tempo(0, 0, 100).tempo(0, 0, 110).tempo(1, 0, 110));
    expect(map.points).toEqual([{ tick: 0, qpm: 110 }]);
  });
});

describe('buildTempoMap: tempo after a skip or a jump follows the performance', () => {
  it('a tempo change inside a skipped 1st ending does not carry into the 2nd ending and beyond', () => {
    // |: 1 (120) | [1. 2 (60 at beat 3) :| [2. 3 | 4
    const { map, occurrences } = mapOf(
      new ScoreBuilder()
        .measure({ forward: true })
        .measure({ endingStart: [1], endingStop: 'stop', backward: true })
        .measure({ endingStart: [2], endingStop: 'discontinue' })
        .measure()
        .tempo(0, 0, 120)
        .tempo(1, 2, 60),
    );
    expect(measureIndexes(occurrences)).toEqual([0, 1, 0, 2, 3]);
    expect(map.points).toEqual([
      { tick: 0, qpm: 120 },
      { tick: 24, qpm: 60 },
      { tick: 32, qpm: 120 },
    ]);
    // 2nd ending and measure 4 at 120: 2 s each.
    expect(tickToSeconds(map, 64) - tickToSeconds(map, 48)).toBeCloseTo(2, 9);
    expect(tickToSeconds(map, 80) - tickToSeconds(map, 64)).toBeCloseTo(2, 9);
  });

  it('To Coda skips the measures between it and the coda, and their tempo marks with them', () => {
    // 1 (100) | 2 To Coda | 3 (50) D.C. | 4 Coda
    const { map, occurrences } = mapOf(
      new ScoreBuilder()
        .measure()
        .measure({ toCoda: true })
        .measure({ daCapo: true })
        .measure({ coda: true })
        .tempo(0, 0, 100)
        .tempo(2, 0, 50),
    );
    expect(measureIndexes(occurrences)).toEqual([0, 1, 2, 0, 1, 3]);
    expect(map.points).toEqual([
      { tick: 0, qpm: 100 },
      { tick: 32, qpm: 50 },
      { tick: 48, qpm: 100 },
    ]);
  });

  it('a D.C. back to a pickup before the first tempo mark resumes at the first tempo', () => {
    // pickup (no mark) | 1 Allegro 120, Fine | 2 rit. 40, D.C. al Fine
    const { map, occurrences } = mapOf(
      new ScoreBuilder()
        .measure({ number: '0', implicit: true, durationTicks: 4 })
        .measure({ fine: true })
        .measure({ daCapo: true })
        .tempo(1, 0, 120)
        .tempo(2, 0, 40),
    );
    expect(measureIndexes(occurrences)).toEqual([0, 1, 2, 0, 1]);
    expect(map.points).toEqual([
      { tick: 0, qpm: 120 },
      { tick: 20, qpm: 40 },
      { tick: 36, qpm: 120 },
    ]);
    // The pickup lasts one quarter at 120 both times: 0.5 s.
    expect(tickToSeconds(map, 40) - tickToSeconds(map, 36)).toBeCloseTo(0.5, 9);
  });
});

describe('tickToSeconds / secondsToTick (re-exported)', () => {
  it('are exact at tempo points of a repeated map', () => {
    const { map } = mapOf(
      new ScoreBuilder()
        .measure({ forward: true })
        .measure({ backward: true })
        .measure()
        .tempo(0, 0, 100)
        .tempo(1, 2, 60),
    );
    // 24 ticks at 100 qpm = 6 quarters = 3.6 s; then 8 ticks at 60 qpm = 2 s.
    expect(tickToSeconds(map, 24)).toBeCloseTo(3.6, 12);
    expect(tickToSeconds(map, 32)).toBeCloseTo(5.6, 12);
    expect(secondsToTick(map, 5.6)).toBeCloseTo(32, 9);
    expect(secondsToTick(map, tickToSeconds(map, 70))).toBeCloseTo(70, 9);
  });
});
