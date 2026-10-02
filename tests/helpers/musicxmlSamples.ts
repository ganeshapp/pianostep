/**
 * Small inline MusicXML documents for importer cases the file fixtures in
 * tests/fixtures/ do not cover. Shared by tests/parser.test.ts and
 * tests/parser.xmldom.test.ts so both DOM implementations see the same input.
 */

const PIANO_PART_LIST = '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>';

function partwise(measures: string, head = PIANO_PART_LIST): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  ${head}
  <part id="P1">
${measures}
  </part>
</score-partwise>
`;
}

function pitch(step: string, octave: number, alter?: number): string {
  const a = alter === undefined ? '' : `<alter>${alter}</alter>`;
  return `<pitch><step>${step}</step>${a}<octave>${octave}</octave></pitch>`;
}

const TWO_STAVES_4_4 = `<time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>`;

/**
 * Cue notes, <transpose> (one for every staff plus a staff-specific one) and
 * velocity from <sound dynamics> and note@dynamics. divisions=2 (48 ticks per quarter).
 *  m1 staff 1, transposed -14 (chromatic -2, octave-change -1):
 *     D5 quarter -> 60, cue E5 quarter (silent, still takes its beat), F5 half -> 63.
 *     staff 2, transpose number="2" chromatic 0: C3 whole -> 48.
 *  m2 transpose reset to 0 for every staff; <sound dynamics="50"/> (velocity 45):
 *     C4 quarter, C4 quarter with dynamics="100" (velocity 90), cue chord D4+F4 half (skipped).
 */
export const CUE_TRANSPOSE = partwise(`
    <measure number="1">
      <attributes>
        <divisions>2</divisions>
        ${TWO_STAVES_4_4}
        <transpose><diatonic>-1</diatonic><chromatic>-2</chromatic><octave-change>-1</octave-change></transpose>
        <transpose number="2"><diatonic>0</diatonic><chromatic>0</chromatic></transpose>
      </attributes>
      <note>${pitch('D', 5)}<duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><cue/>${pitch('E', 5)}<duration>2</duration><voice>1</voice><type size="cue">quarter</type><staff>1</staff></note>
      <note>${pitch('F', 5)}<duration>4</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <backup><duration>8</duration></backup>
      <note>${pitch('C', 3)}<duration>8</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
    </measure>
    <measure number="2">
      <attributes><transpose><diatonic>0</diatonic><chromatic>0</chromatic></transpose></attributes>
      <sound dynamics="50"/>
      <note>${pitch('C', 4)}<duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note dynamics="100">${pitch('C', 4)}<duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><cue/>${pitch('D', 4)}<duration>4</duration><voice>1</voice><type size="cue">half</type><staff>1</staff></note>
      <note><cue/><chord/>${pitch('F', 4)}<duration>4</duration><voice>1</voice><type size="cue">half</type><staff>1</staff></note>
      <backup><duration>8</duration></backup>
      <note>${pitch('C', 3)}<duration>8</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
    </measure>`);

/**
 * Navigation marks, one staff, divisions=1, 4/4, C4 whole note in every measure.
 *  m1 forward repeat; segno sign with <sound segno>.
 *  m2 "To Coda" words with a coda sign and no <sound> (a jump, not the coda itself).
 *  m3 ending "1, 2" (start/stop) and a backward repeat played three times.
 *  m4 ending "3." (start, discontinue); "D.S. al Coda" with a segno sign and <sound dalsegno>.
 *  m5 coda sign on the left barline; <sound tocoda> at measure level.
 *  m6 "Fine" words with no <sound>; separate "D.C." words with no <sound>.
 */
export const NAVIGATION = partwise(`
    <measure number="1">
      <barline location="left"><repeat direction="forward"/></barline>
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <direction placement="above"><direction-type><segno/></direction-type><sound segno="segno"/></direction>
      <note>${pitch('C', 4)}<duration>4</duration><voice>1</voice><type>whole</type></note>
    </measure>
    <measure number="2">
      <note>${pitch('C', 4)}<duration>4</duration><voice>1</voice><type>whole</type></note>
      <direction placement="above">
        <direction-type><words>To Coda</words></direction-type>
        <direction-type><coda/></direction-type>
      </direction>
    </measure>
    <measure number="3">
      <barline location="left"><ending number="1, 2" type="start">1. 2.</ending></barline>
      <note>${pitch('C', 4)}<duration>4</duration><voice>1</voice><type>whole</type></note>
      <barline location="right"><ending number="1, 2" type="stop"/><repeat direction="backward" times="3"/></barline>
    </measure>
    <measure number="4">
      <barline location="left"><ending number="3." type="start">3.</ending></barline>
      <note>${pitch('C', 4)}<duration>4</duration><voice>1</voice><type>whole</type></note>
      <direction placement="above">
        <direction-type><words>D.S. al Coda</words></direction-type>
        <direction-type><segno/></direction-type>
        <sound dalsegno="segno"/>
      </direction>
      <barline location="right"><ending number="3." type="discontinue"/></barline>
    </measure>
    <measure number="5">
      <barline location="left"><coda/></barline>
      <note>${pitch('C', 4)}<duration>4</duration><voice>1</voice><type>whole</type></note>
      <sound tocoda="coda"/>
    </measure>
    <measure number="6">
      <note>${pitch('C', 4)}<duration>4</duration><voice>1</voice><type>whole</type></note>
      <direction><direction-type><words>Fine</words></direction-type></direction>
      <direction><direction-type><words>D.C.</words></direction-type></direction>
    </measure>`);

/**
 * Pickup, short and empty measures, and a cross-staff note. 3/4, divisions=1, 2 staves.
 *  m "0" implicit pickup: RH G4 quarter.
 *  m "1": RH C5 half, D5 quarter. LH voice 5: C3 quarter, G4 quarter drawn on staff 1
 *         (cross-staff), C3 quarter.
 *  m "2" (not implicit): only two quarters E5 E5 (shorter than 3/4).
 *  m "3": empty measure element (takes its time-signature length).
 */
export const PICKUP_CROSS_STAFF = partwise(`
    <measure number="0" implicit="yes">
      <attributes>
        <divisions>1</divisions>
        <time><beats>3</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note>${pitch('G', 4)}<duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
    </measure>
    <measure number="1">
      <note>${pitch('C', 5)}<duration>2</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <note>${pitch('D', 5)}<duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <backup><duration>3</duration></backup>
      <note>${pitch('C', 3)}<duration>1</duration><voice>5</voice><type>quarter</type><staff>2</staff></note>
      <note>${pitch('G', 4)}<duration>1</duration><voice>5</voice><type>quarter</type><staff>1</staff></note>
      <note>${pitch('C', 3)}<duration>1</duration><voice>5</voice><type>quarter</type><staff>2</staff></note>
    </measure>
    <measure number="2">
      <note>${pitch('E', 5)}<duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note>${pitch('E', 5)}<duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
    </measure>
    <measure number="3"/>`);

/**
 * Grace-note edge cases. divisions=8 (ticksPerQuarter 48, grace slot cap 48/8 = 6), 4/4.
 *  voice 1, staff 1:
 *   - grace chord E5+G5 (one slot), grace D5, then principal chord C5+E4 quarter:
 *     k=2, g=min(floor(48/3), 6)=6 -> slots at 0 and 6, principal chord at 12 for 36.
 *   - graces B4, A4 before a D5 thirty-second (6 ticks): g=min(floor(6/3), 6)=2
 *     -> 48, 50; principal at 52 for 2.
 *   - F5 for 7 divisions (42 ticks) at 54, then grace G5 followed by a rest:
 *     no principal, so it steals from the end of F5: g=min(floor(42/2), 6)=6,
 *     F5 keeps 36, G5 at 90 for 6.
 *   - quarter rest, C5 quarter at 144.
 *  voice 2: a grace A4 with no note before or after it in its voice (dropped), then a <forward>.
 */
export const GRACE_EDGES = partwise(`
    <measure number="1">
      <attributes>
        <divisions>8</divisions>
        ${TWO_STAVES_4_4}
      </attributes>
      <note><grace/>${pitch('E', 5)}<voice>1</voice><type>16th</type><staff>1</staff></note>
      <note><grace/><chord/>${pitch('G', 5)}<voice>1</voice><type>16th</type><staff>1</staff></note>
      <note><grace/>${pitch('D', 5)}<voice>1</voice><type>16th</type><staff>1</staff></note>
      <note>${pitch('C', 5)}<duration>8</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><chord/>${pitch('E', 4)}<duration>8</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><grace/>${pitch('B', 4)}<voice>1</voice><type>32nd</type><staff>1</staff></note>
      <note><grace/>${pitch('A', 4)}<voice>1</voice><type>32nd</type><staff>1</staff></note>
      <note>${pitch('D', 5)}<duration>1</duration><voice>1</voice><type>32nd</type><staff>1</staff></note>
      <note>${pitch('F', 5)}<duration>7</duration><voice>1</voice><type>eighth</type><staff>1</staff></note>
      <note><grace/>${pitch('G', 5)}<voice>1</voice><type>16th</type><staff>1</staff></note>
      <note><rest/><duration>8</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note>${pitch('C', 5)}<duration>8</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <backup><duration>32</duration></backup>
      <note><grace/>${pitch('A', 4)}<voice>2</voice><type>16th</type><staff>1</staff></note>
      <forward><duration>32</duration><voice>2</voice><staff>1</staff></forward>
    </measure>`);

/**
 * <divisions> changing in the middle of a measure (2 -> 3); ticksPerQuarter = lcm(2, 3, 48) = 48.
 *  RH: C4 quarter (2 divisions), then D4 quarter (3), E4 half (6).  LH: C3 whole (12 at divisions 3).
 */
export const DIVISIONS_MID_MEASURE = partwise(`
    <measure number="1">
      <attributes>
        <divisions>2</divisions>
        ${TWO_STAVES_4_4}
      </attributes>
      <note>${pitch('C', 4)}<duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <attributes><divisions>3</divisions></attributes>
      <note>${pitch('D', 4)}<duration>3</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note>${pitch('E', 4)}<duration>6</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <backup><duration>12</duration></backup>
      <note>${pitch('C', 3)}<duration>12</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
    </measure>`);

/**
 * Unusual notes in one staff, divisions=1, 4/4:
 *  C4 with alter 0.5 (rounded up to 61), E4 with alter -0.5 (rounded to 64),
 *  C9 (above the piano), an unpitched note, a pitched note with zero duration,
 *  and a hidden (print-object="no") G4 whole note with no <voice> (defaults to "1").
 */
export const ODD_NOTES = partwise(`
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note>${pitch('C', 4, 0.5)}<duration>1</duration><voice>1</voice><type>quarter</type></note>
      <note>${pitch('E', 4, -0.5)}<duration>1</duration><voice>1</voice><type>quarter</type></note>
      <note>${pitch('C', 9)}<duration>1</duration><voice>1</voice><type>quarter</type></note>
      <note><unpitched><display-step>E</display-step><display-octave>4</display-octave></unpitched><duration>1</duration><voice>1</voice><type>quarter</type></note>
    </measure>
    <measure number="2">
      <note>${pitch('D', 4)}<duration>0</duration><voice>1</voice><type>quarter</type></note>
      <note print-object="no">${pitch('G', 4)}<duration>4</duration><type>whole</type></note>
    </measure>`);

/**
 * Ornaments, tremolo, arpeggio and pedal marks: all notes play as written, with warnings.
 * divisions=1, 4/4, one staff.
 *  m1 pedal start; C4 quarter with a trill; D4 quarter with a single-note tremolo;
 *     arpeggiated chord E4+G4 half; pedal stop (not counted).
 *  m2 pedal change (counted); C4 whole.
 */
export const ORNAMENTS_PEDAL = partwise(`
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <direction><direction-type><pedal type="start"/></direction-type></direction>
      <note>${pitch('C', 4)}<duration>1</duration><voice>1</voice><type>quarter</type><notations><ornaments><trill-mark/></ornaments></notations></note>
      <note>${pitch('D', 4)}<duration>1</duration><voice>1</voice><type>quarter</type><notations><ornaments><tremolo type="single">3</tremolo></ornaments></notations></note>
      <note>${pitch('E', 4)}<duration>2</duration><voice>1</voice><type>half</type><notations><arpeggiate/></notations></note>
      <note><chord/>${pitch('G', 4)}<duration>2</duration><voice>1</voice><type>half</type><notations><arpeggiate/></notations></note>
      <direction><direction-type><pedal type="stop"/></direction-type></direction>
    </measure>
    <measure number="2">
      <direction><direction-type><pedal type="change"/></direction-type></direction>
      <note>${pitch('C', 4)}<duration>4</duration><voice>1</voice><type>whole</type></note>
    </measure>`);

/**
 * Metadata that looks like markup. Every value must come back as literal text.
 */
export const MARKUP_METADATA = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>&lt;script&gt;alert("title")&lt;/script&gt;</work-title></work>
  <movement-title><![CDATA[<img src=x onerror=alert(1)>]]></movement-title>
  <identification>
    <creator type="composer">&amp;lt;b&amp;gt;Bold&amp;lt;/b&amp;gt;</creator>
    <creator type="arranger">A &amp; B</creator>
    <rights>Copyright <b>Someone</b></rights>
    <encoding><software>&lt;svg onload=alert(1)&gt;</software></encoding>
  </identification>
  <credit page="1"><credit-type>lyricist</credit-type><credit-words>&lt;iframe src="javascript:alert(1)"&gt;</credit-words></credit>
  <part-list><score-part id="P1"><part-name>&lt;b&gt;Piano&lt;/b&gt;</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <direction><direction-type><words>&lt;script&gt;x&lt;/script&gt;</words></direction-type></direction>
      <note>${pitch('C', 4)}<duration>4</duration><voice>1</voice><type>whole</type></note>
    </measure>
  </part>
</score-partwise>
`;

/** The partwise equivalent of tests/fixtures/f-timewise.musicxml. */
export const TIMEWISE_AS_PARTWISE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Right Hand</part-name></score-part>
    <score-part id="P2"><part-name>Left Hand</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note>${pitch('C', 4)}<duration>4</duration><voice>1</voice><type>half</type></note>
      <note>${pitch('E', 4)}<duration>4</duration><voice>1</voice><type>half</type></note>
    </measure>
    <measure number="2">
      <note>${pitch('G', 4)}<duration>8</duration><voice>1</voice><type>whole</type></note>
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes>
      <note>${pitch('C', 3)}<duration>8</duration><voice>1</voice><type>whole</type></note>
    </measure>
    <measure number="2">
      <note>${pitch('G', 2)}<duration>8</duration><voice>1</voice><type>whole</type></note>
    </measure>
  </part>
</score-partwise>
`;

/** A DOCTYPE with an external SYSTEM DTD and an internal subset (no entities). */
export const EXTERNAL_DTD_WITH_SUBSET = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- comment before the DOCTYPE -->
<!DOCTYPE score-partwise SYSTEM "http://127.0.0.1:9/never-fetched.dtd" [
  <!ELEMENT extra ANY>
  <!ATTLIST extra note CDATA "a ] inside quotes >">
]>
<score-partwise version="4.0">
  ${PIANO_PART_LIST}
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note>${pitch('C', 4)}<duration>4</duration><voice>1</voice><type>whole</type></note>
    </measure>
  </part>
</score-partwise>
`;

/** Every inline sample that parses successfully, by name. */
export const VALID_SAMPLES: Readonly<Record<string, string>> = {
  'cue-transpose': CUE_TRANSPOSE,
  navigation: NAVIGATION,
  'pickup-cross-staff': PICKUP_CROSS_STAFF,
  'grace-edges': GRACE_EDGES,
  'divisions-mid-measure': DIVISIONS_MID_MEASURE,
  'odd-notes': ODD_NOTES,
  'ornaments-pedal': ORNAMENTS_PEDAL,
  'markup-metadata': MARKUP_METADATA,
  'timewise-as-partwise': TIMEWISE_AS_PARTWISE,
  'external-dtd-with-subset': EXTERNAL_DTD_WITH_SUBSET,
};

/** Inline documents that must be rejected, with the ImportError code expected. */
export const INVALID_SAMPLES: Readonly<Record<string, { xml: string; code: string }>> = {
  'html page': { xml: '<html><body><p>Hello</p></body></html>', code: 'not-musicxml' },
  'other xml root': { xml: '<?xml version="1.0"?><opus><title>x</title></opus>', code: 'not-musicxml' },
  'parameter entity': {
    xml: '<!DOCTYPE score-partwise [<!ENTITY % ext SYSTEM "http://127.0.0.1:9/x.ent"> %ext;]><score-partwise/>',
    code: 'unsafe-content',
  },
  'external entity': {
    xml: '<!DOCTYPE score-partwise [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><score-partwise><work><work-title>&xxe;</work-title></work></score-partwise>',
    code: 'unsafe-content',
  },
  'undefined entity': {
    xml: '<score-partwise><work><work-title>Caf&eacute;</work-title></work><part-list/><part id="P1"><measure number="1"/></part></score-partwise>',
    code: 'malformed-xml',
  },
  'unescaped ampersand': {
    xml: '<score-partwise><work><work-title>Rock & Roll</work-title></work><part-list/><part id="P1"><measure number="1"/></part></score-partwise>',
    code: 'malformed-xml',
  },
  'control character': {
    xml: '<score-partwise><work><work-title>A\u0001B</work-title></work><part-list/><part id="P1"><measure number="1"/></part></score-partwise>',
    code: 'malformed-xml',
  },
  'unquoted attribute': {
    xml: '<score-partwise version=4.0><part-list/><part id="P1"><measure number="1"/></part></score-partwise>',
    code: 'malformed-xml',
  },
  'attribute without value': {
    xml: '<score-partwise version><part-list/><part id="P1"><measure number="1"/></part></score-partwise>',
    code: 'malformed-xml',
  },
  'two root elements': {
    xml: '<score-partwise><part-list/><part id="P1"><measure number="1"/></part></score-partwise><score-partwise/>',
    code: 'malformed-xml',
  },
  'unterminated doctype': { xml: '<!DOCTYPE score-partwise [ <!ELEMENT x ANY> <score-partwise/>', code: 'malformed-xml' },
  'no parts': { xml: '<score-partwise version="4.0"><part-list/></score-partwise>', code: 'empty-score' },
  'part without measures': {
    xml: '<score-partwise version="4.0"><part-list/><part id="P1"/></score-partwise>',
    code: 'empty-score',
  },
};
