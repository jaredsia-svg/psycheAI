"""Short reels for Instagram (about 20 s each): their voiceover, timeline, music and mix.

    python shorts.py notes   # "Your Instagram has been taking notes on you": Mulan
    python shorts.py mbti    # "I took the MBTI test three times": Odysseus
    python shorts.py coach   # "Some questions are hard to ask anyone": Ask PsycheAI
    python shorts.py coach-misunderstood   # the same, opening on "What do people misunderstand about me?"

npm run promo:shorts builds both. The same voice as the other videos (vo.py, imported for it), and music
from the main video's instruments: each reel its own tempo, key and feel, so they sound related but not
the same. Each line's take is kept, as in privacy.py, and remade only when its words change or with --vo.
"""
import hashlib, json, math, os, subprocess, sys, wave
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REEL = sys.argv[1]

# (phrases, length scale, record each phrase on its own[, pause]), as in vo.py; one line a scene. The voice
# script spells as it is said: "organizes", "organizer", "center" (the screen: organises, organiser, centre), "E N T P".
REELS = {
    'notes': {
        'lines': [
            (['Your Instagram has been taking notes on you for years.'], 0.92, None),
            (["It knows you're the one who organizes every plan,", 'you give more attention than you ask for,',
              "and you're the first to check on a friend who's gone quiet."], 0.92, True, 0.08),
            (['So I let {B} read it.'], 0.92, None),
            (['I got {Mulan}. The organizer with a warm center.'], 0.92, None),
            (["Comment card, and I'll send you the link."], 0.92, None),
        ],
        # Curious, then bright: A minor (Am F C G) at 112, a ticking pulse under the habits, the reveal on the hit.
        'bpm': 112, 'chords': [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]], 'roots': [45, 41, 36, 43],
        'melody': [[76, 72, 69, 72], [77, 72, 69, 72], [79, 76, 72, 76], [74, 71, 67, 71]],
        'reveal': 3, 'swing': 0.0, 'early_claps': False,
    },
    'mbti': {
        'lines': [
            (['I took the MBTI test three times,', 'and got three different answers.'], 0.92, None),
            (['So I loaded my Instagram data instead.'], 0.92, None),
            (['No questions asked.', 'Just what my online patterns actually show.'], 0.92, None),
            (['I got {Odysseus}. E N T P, with the evidence.'], 0.92, None),
            (['What does yours say? Comment your type.'], 0.92, None),
        ],
        # Playful: the main video's C G Am F moved up to D (D A Bm G) at 124, with claps from the start and
        # the plucks a little swung.
        'bpm': 124, 'chords': [[62, 66, 69], [57, 61, 64], [59, 62, 66], [55, 59, 62]], 'roots': [38, 45, 47, 43],
        'melody': [[78, 76, 74, 76], [76, 73, 69, 73], [74, 78, 81, 78], [79, 78, 74, 71]],
        'reveal': 3, 'swing': 0.06, 'early_claps': True,
    },
    'coach': {
        # At the other reels' pace, each question held for a breath, the regret one a little longer.
        'lines': [
            (['Some questions are hard to ask anyone.'], 0.92, None),
            (['What am I most insecure about?'], 0.92, None),
            (['What do I keep trying to prove, and to whom?'], 0.92, None),
            (["What would I regret most, when I'm old?"], 0.92, None),
            (['{B} answers from what your own data shows.'], 0.92, None),
            (['A coach that already knows you.'], 0.92, None),
            (['Ask yours at {B} dot I O.'], 0.9, None),
        ],
        'hold': {1: 0.5, 2: 0.5, 3: 1.0, 4: 3.0, 5: 1.0},  # 4: the data read, then the answer begins; 5: time to read it
        # Its own piece, hopeful rather than sombre: E minor to G (Em C G D) at 88, a rolling piano and strings
        # swelling through the questions, lifting into a light beat and bells as the answer types.
        'mood': 'uplifting', 'bpm': 88,
        'chords': [[64, 67, 71], [60, 64, 67], [67, 71, 74], [62, 66, 69]], 'roots': [40, 36, 43, 38],
        'melody': [[79, 78, 76, 74], [76, 79, 81, 79], [83, 81, 79, 74], [78, 76, 74, 78]],
        'reveal': 4, 'swing': 0.0, 'early_claps': False,
    },
}
# The roast: the card is nice, then the roast button is pressed and three burns land, each punchline on a beat.
# Every line is a phrase pair, set-up then punchline, recorded apart so the punchline can be moved onto the beat
# (`punch`). The numbers are a made-up sample, written as said ("K" is said as the letter, "on red" is "left on
# read", which the voice otherwise says in the present tense). Its own voice:
# Piper's Ryan, male and lighter than the others tried.
REELS['roast'] = {
    'voice': 'en_US-ryan-high',
    'lines': [
        (['My Psyche Card was so nice.', 'Then I clicked, reveal my roast.'], 0.85, True, 0.2),
        (["You've saved three hundred cooking videos.", 'Your most cooked dish is instant noodles.'], 0.85, True, 0.15),
        (["You've viewed fifty eight apartments.", 'You still live with your parents.'], 0.85, True, 0.15),
        (["You've searched, is it too late to, twenty three times.", "You're only twenty seven."], 0.85, True, 0.15),
        (['Then it tells you what an honest friend would.'], 0.85, None),
        (['Your roast is free with every card.', "Comment roast, if you're brave."], 0.85, True, 0.15),
    ],
    'hold': {1: 0.15, 2: 0.15, 3: 0.6, 4: 5.1},  # 4: time to read the honest friend
    'punch': (1, 2, 3),
    # Its own piece, brass house: F major (F Dm Bb C) at 124. Piano stabs and a soft kick under the nice card;
    # then four on the floor, open hats on the offbeat, a funky octave bass and a bright brass hook; the drums drop
    # out for the beat before each punchline and a horn hit lands on it. Then a breakdown of held chords from the
    # honest friend to the end, rising gently into a last held chord.
    'mood': 'roast', 'bpm': 124,
    'chords': [[65, 69, 72], [62, 65, 69], [58, 62, 65], [60, 64, 67]], 'roots': [41, 38, 46, 48],
    # The hook, in eighths (None a rest).
    'riff': [[77, None, 77, 79, None, 81, None, 77], [74, None, 74, 77, None, 79, 77, None],
             [74, None, 74, 77, None, 81, None, 82], [84, None, 81, None, 79, None, 77, None]],
    'reveal': 1, 'swing': 0.0, 'early_claps': False,
    'music_lift': (4, 1.35),  # from the honest friend to the end, the music a little louder (24 October 2026)
}
# The career reel: the job questions everyone has, asked of PsycheAI, answered from the reader's own data, then
# what the report's career assessment adds. The same voice as the roast.
REELS['career'] = {
    'voice': 'en_US-ryan-high',
    'lines': [
        (['Struggling with your job?'], 0.85, None),
        (['Am I in the wrong job?', 'Why do I dread going to work?'], 0.95, True, 0.4),
        (['So I asked {B},', 'and it answered from my own data.'], 0.85, True, 0.1),
        (["You don't hate your job.", 'You hate the routine parts of it.'], 0.85, True, 0.15),
        (['Your Psyche Report goes further.', 'Your edge at work,', "what's holding you back,", 'and the careers that suit you best.'], 0.85, True, [0.2, 0.06, 0.06]),
        (['A coach that already knows you.', 'Try it at {B} dot I O.'], 0.85, True, 0.2),
    ],
    'hold': {0: 0.5, 1: 1.8, 3: 4.5, 4: 1.0},  # 1: "am I the problem?" typed after the voice; 3: time to read the whole answer
    # Its own piece, hopeful: B minor (Bm G D A) at 96 for the questions, a muffled piano and a slow pulse; a swell
    # into D major (D A Bm G) for the answer, with a light beat, a warm bass and a plucked tune; fuller for the
    # report; a held D chord to close.
    'mood': 'career', 'bpm': 96,
    'chords': [[59, 62, 66], [55, 59, 62], [62, 66, 69], [57, 61, 64]], 'roots': [47, 43, 38, 45],
    'lift': [[62, 66, 69], [57, 61, 64], [59, 62, 66], [55, 59, 62]], 'lift_roots': [38, 45, 47, 43],
    'melody': [[74, 78, 81, 78], [76, 73, 69, 73], [74, 71, 78, 74], [79, 78, 74, 71]],
    'reveal': 3, 'swing': 0.0, 'early_claps': False,
}
# The relationship reel: a wife asking why she and her husband fight over small things; the fights as messages,
# PsycheAI asked and answering from her own data, then what the report covers. Only her data is read, so nothing
# here speaks for him or for the couple. A warm female voice.
REELS['relationship'] = {
    'voice': 'en_US-hfc_female-medium',
    'lines': [
        (['We fought about the dishes.', 'Again.'], 0.85, True, 0.35),
        (['Different topic.', 'Same fight.'], 0.85, True, 0.3),
        (['So I asked {B} why we keep fighting over small things,', 'and it answered from my own data.'], 0.85, True, 0.15),
        (["It's not the dishes.", "It's feeling like you come second."], 0.85, True, 0.3),
        (['Your Psyche Report shows how you love,', 'your attachment style,', 'how you handle conflict,', 'and what you need from the person you love.'], 0.85, True, [0.1, 0.1, 0.1]),
        (['A coach that already knows you.', 'Try it at {B} dot I O.'], 0.85, True, 0.2),
    ],
    'lead': {1: 2.8},                  # 1: the fights stack up before the voice names them
    'hold': {0: 0.3, 3: 4.2, 4: 0.8},  # 3: time to read the whole answer
    # Its own piece, warm and reflective: F sharp minor to A (F#m D A E) at 84, an electric piano with a slow tremolo.
    # The fights get a low pulse that tightens; the asking falls back to the piano alone; the answer lifts into a soft
    # groove of brushed snare, rim and bass with a vibraphone tune; a softly rolled A chord to close.
    'mood': 'relationship', 'bpm': 84,
    'chords': [[54, 57, 61], [50, 54, 57], [57, 61, 64], [52, 56, 59]], 'roots': [42, 38, 45, 40],
    'melody': [[73, 69, 66, 69], [74, 69, 66, 69], [76, 73, 69, 73], [71, 68, 64, 68]],
    'reveal': 3, 'swing': 0.0, 'early_claps': False,
}
# The comparison reel: the same question asked of ChatGPT and of PsycheAI, both answers real and only trimmed,
# never reworded ("Chat G P T" is how the voice says the name, and "red" the past tense of read). ChatGPT's could fit anyone; PsycheAI's is drawn from the asker's own data. The career reel's
# instruments in a key and tempo of their own; Ryan's voice, as the career reel.
REELS['compare'] = {
    'voice': 'en_US-ryan-high',
    'lines': [
        (['I asked Chat G P T and {B} the same question.', ("What would I regret most about my life when I'm old?", 1.05)], 0.85, True, 0.5),
        (['Chat G P T gave me a list that could fit anyone.'], 0.85, None),
        (['{B} red my data first.'], 0.85, None),
        (['And it told me exactly why.'], 0.85, None),
        (['Same question.', 'Only one of them actually knew me.'], 0.85, True, 0.3),
        (['Your personal AI coach.', 'Try it at {PsycheAIdotIO}.'], 0.85, True, 0.2),
    ],
    'hold': {0: 0.6, 1: 2.1, 2: 0.9, 3: 6.6, 4: 0.8},  # 1 and 3: time to read each answer; the question is said slower
    'lead': {5: 1.6},  # 5: the closing thought is read before the voice comes in
    # Its own key and tempo on the career reel's instruments: A minor (Am F C G) at 100 under ChatGPT's answer, a
    # muffled piano and a slow pulse; a swell into C major (C G Am F) for PsycheAI's, with a light beat and a plucked
    # tune; fuller for the verdict; the beat stops for the close (`calm_close`), the piano carrying it to a C chord
    # rolled softly.
    'mood': 'career', 'bpm': 100, 'calm_close': True,
    'chords': [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]], 'roots': [45, 41, 48, 43],
    'lift': [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]], 'lift_roots': [36, 43, 45, 41],
    'melody': [[72, 76, 79, 76], [74, 71, 67, 71], [72, 69, 76, 72], [77, 76, 72, 69]],
    'reveal': 3, 'swing': 0.0, 'early_claps': False,
}
# The character reel (24 October 2026): which character are you? A slot machine of all 28 characters' scenes, no
# names, spins, crawls past the last few and lands on the Tin Man; then a tour of his card (headline, a pattern,
# most in sync with) ending on "Who's your Mulan? Tag them." Ryan's voice.
REELS['character'] = {
    'voice': 'en_US-ryan-high',
    'lines': [
        (['I let {B} read eleven years of my Instagram.', 'Then it told me which character I am.'], 0.85, True, 0.3),  # each reel its own years
        (['Twenty eight characters.', 'One match.'], 0.85, True, 0.5),
        (['The Tin Man.'], 0.85, None),
        (['Big hearted builder, who shows love by showing up.', 'Checks in on the quiet ones.', 'Most in sync with {Mulan}.'], 0.85, True, [0.6, 0.6]),
        (["Who's your {Mulan}?", 'Tag them.'], 0.85, True, 0.3),
        (['Which character are you?', 'Find out at {PsycheAIdotIO}.'], 0.85, True, 0.3),
    ],
    'hold': {1: 2.6, 2: 0.4, 3: 0.8, 4: 1.4},  # 1: the long spin; 3: the card's three stops; 4: the tag
    'lead': {3: 0.9},  # 3: the whole card seen before the camera moves in
    # Its own piece, bright pop: C major (C G Am F) at 108, a muted pluck under the hook, the slot's ticks slowing
    # with it, a riser into a hit as it lands, then the full beat and a bell tune to the end.
    'mood': 'character', 'bpm': 108,
    'chords': [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]], 'roots': [36, 43, 45, 41],
    'melody': [[76, 79, 84, 79], [74, 79, 83, 79], [76, 72, 69, 72], [77, 76, 72, 74]],
    'reveal': 2, 'swing': 0.0, 'early_claps': False,
    'spin': 58, 'spin_ease': 2,  # tiles the slot passes before it stops, and how long it crawls at the end (character-stage.html uses the same)
}
# The same for Rapunzel (24 October 2026): Sofia Reyes's sample card, tagging Sherlock (the Tin Man's tags Mulan).
# A woman's voice (the relationship reel's), the same music.
def character_hook(years):
    return (['I let {B} read ' + years + ' years of my Instagram.', 'Then it told me which character I am.'], 0.85, True, 0.3)
REELS['character-rapunzel'] = dict(REELS['character'], voice='en_US-hfc_female-medium', lines=[
    character_hook('seven'), REELS['character']['lines'][1],
    (['Rapunzel.'], 0.85, None),
    (['Hopeful maker, who turns a small room into a studio.', 'Hope that outlasts the setback.', 'Most in sync with Sherlock.'], 0.85, True, [0.6, 0.6]),
    (["Who's your Sherlock?", 'Tag them.'], 0.85, True, 0.3),
    REELS['character']['lines'][5],
])

# And for Mulan, Odysseus and Sherlock (24 October 2026): no tag; each tour stops on parts of its card the others do
# not (character-stage.html, WHO), then the close.
def character_reel(voice, years, name_line, stops):
    return dict(REELS['character'], voice=voice, lines=[
        character_hook(years), REELS['character']['lines'][1], ([name_line], 1.05, None),
        (stops, 0.85, True, [0.6, 0.6]), REELS['character']['lines'][5]],
        hold={1: 2.6, 2: 0.4, 3: 1.6}, lead={3: 0.9})
REELS['character-mulan'] = character_reel('en_US-hfc_female-medium', 'nine', '{Mulan}.',
    ['Organiser with a warm centre, and a quiet battery.', 'Driven by care for my people.', 'Shows care through acts of service.'])
REELS['character-odysseus'] = character_reel('en_US-ryan-high', 'twelve', '{Odysseus}.',
    ['Resourceful planner, with a way out of every corner.', 'Driven by stimulation, achievement, and self direction.', '{MBTIofENTP}.'])
REELS['character-sherlock'] = character_reel('en_US-ryan-high', 'eight', 'Sherlock Holmes.',
    ['Quiet investigator, who notices what others miss.', 'Big Five. Openness, eighty five.', 'Values truth, and independence.'])

# The mirror reel (24 October 2026): who I say I am against what my data says, three times, then who it says I am.
# Each claim is a trait a little less flattering than he would admit (a talker, not over her, particular), a set-up
# and a punchline as the roast's burns are. Ryan's voice.
REELS['mirror'] = {
    'voice': 'en_US-ryan-high',
    # Opens on the first claim; from the third straight to the close (24 October 2026).
    'lines': [
        (['I always thought I was a great listener.', 'Until {B} put me in my place.'], 0.85, True, 0.2),
        (['I always thought I was easygoing, and chill.', 'Until my data showed me otherwise.'], 0.85, True, 0.2),
        (['I thought I was over my ex.', 'Apparently not.'], 0.85, True, 0.3),
        (["You're not who you think you are.", 'Understand yourself better at {PsycheAIdotIOquick}.'], 0.85, True, 0.35),
    ],
    'hold': {0: 0.9, 1: 0.9, 2: 1.1},  # the number read after each
    'punch': (0, 1, 2),
    # Its own piece: lo-fi chill hop in D minor (Dm7 Bbmaj7 Gm7 A7) at 84, swung: a warm electric piano, a soft
    # boom-bap beat, a bouncing bass, a soft pad, vinyl crackle, from the first word, rolling on under every "until"
    # with only a soft accent on the punchline (no stop); for the close it opens into F major (Fmaj7 C Dm7 Bbmaj7), ending on a held Fmaj9.
    # (Tried and dropped on 24 October: pizzicato over an 808 with a record scratch; this with a tape stop on each
    # "until"; a cool-jazz trio with a muted-trumpet wah-wah.)
    'mood': 'mirror', 'bpm': 84,
    'chords': [[62, 65, 69, 72], [58, 62, 65, 69], [55, 58, 62, 65], [57, 61, 64, 67]], 'roots': [38, 34, 43, 45],
    'lift': [[65, 69, 72, 76], [60, 64, 67, 72], [62, 65, 69, 72], [58, 62, 65, 69]], 'lift_roots': [41, 36, 38, 34],
    'melody': [[74, 72, 69, 72], [74, 77, 76, 72], [70, 69, 67, 65], [69, 73, 76, 73]],
    'reveal': 3, 'swing': 0.06, 'early_claps': False,
}
# The comparison reel's music, chosen from three tried under the same video (the career reel's instruments, the
# coach reel's piano and strings, and this): the relationship reel's electric piano groove, in A minor to C, its
# ending kept in that key (F then G, home to C; the relationship reel's own ending is in A).
REELS['compare'] = dict(REELS['compare'], mood='relationship',
                        chords=[[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]], roots=[45, 41, 48, 43],
                        melody=[[76, 72, 69, 72], [77, 72, 69, 72], [79, 76, 72, 76], [74, 71, 67, 71]],
                        cadence=[([53, 57, 60], 41), ([55, 59, 62], 43)], end_chord=[36, 48, 52, 55, 60, 64])
# The comparison reel again, on "What am I most insecure about?" (24 October 2026): the same stage, music and close.
# ChatGPT's answer says itself that it is guessing, so that is what the voice says about it.
REELS['compare-insecure'] = dict(REELS['compare'], lines=[
    (['I asked Chat G P T and {B} the same question.', ('What am I most insecure about?', 1.05)], 0.85, True, 0.5),
    (['Chat G P T admitted it was guessing.'], 0.85, None),
    REELS['compare']['lines'][2],
    (['And it found the fear I never say out loud.'], 0.85, None),
] + REELS['compare']['lines'][4:], hold={0: 0.6, 1: 2.4, 2: 0.9, 3: 6.0, 4: 0.8},
    voice='en_US-hfc_female-medium')  # a woman's answer, so a woman's voice (the relationship reel's)
# The same reel opening on "What do people misunderstand about me?" instead, the gentler first cut, kept to
# post a few days apart and compare.
REELS['coach-misunderstood'] = dict(REELS['coach'], lines=[REELS['coach']['lines'][0], (['What do people misunderstand about me?'], 0.92, None)] +
                                    REELS['coach']['lines'][2:])
R = REELS[REEL]
LINES = R['lines']
BUILD = HERE + '/build/' + REEL
os.makedirs(BUILD, exist_ok=True)

names = ['p' + hashlib.sha1(json.dumps([line, R['voice']] if 'voice' in R else line).encode()).hexdigest()[:10] for line in LINES]
if 'voice' in R: os.environ['PROMO_VOICE'] = R['voice']
stored = json.load(open(BUILD + '/marks.json')) if os.path.exists(BUILD + '/marks.json') else {'lines': {}, 'words': {}}
todo = [(name, line) for name, line in zip(names, LINES)
        if '--vo' in sys.argv or name not in stored['lines'] or not os.path.exists(f'{BUILD}/{name}.wav')]
if todo:
    import vo
    vo.OUT = BUILD
    for name, line in todo: stored['lines'][name] = vo.write(name, *line)
    stored['words'].update(vo.word_marks)
    json.dump(stored, open(BUILD + '/marks.json', 'w'))

import imageio_ffmpeg
FF = imageio_ffmpeg.get_ffmpeg_exe()
SR = 48000
def load(path):
    out = subprocess.run([FF, '-v', 'error', '-i', path, '-f', 's16le', '-ac', '1', '-ar', str(SR), '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype=np.int16).astype(np.float32) / 32768.0

lines = [load(f'{BUILD}/{name}.wav') for name in names]
dur = [len(x) / SR for x in lines]
word_marks = [stored['words'][name] for name in names]
marks = [stored['lines'][name] for name in names]

BPM = R['bpm']; BEAT = 60 / BPM; BAR = 4 * BEAT
GAP, LEAD = 0.02, 0.2
REVEAL = R['reveal']
# The reveal lets the card land before the voice names it; every cut snaps to the half beat.
EXTRA_LEAD = {REVEAL: 0.45 if R.get('mood') != 'uplifting' else 0.6}
snap = lambda x, step: math.ceil(x / step - 1e-6) * step
scenes, t = [], 0.0
for i in range(len(lines)):
    lead = 0.3 if i == 0 else LEAD + EXTRA_LEAD.get(i, 0) + R.get('lead', {}).get(i, 0)
    if i in R.get('punch', ()):
        # Silence before the punchline so it starts on the next beat: a beat's pause at most, the comic one.
        cut = marks[i][1]; at = t + lead + cut
        pad = snap(at + 0.12, BEAT) - at
        a = int(cut * SR)
        lines[i] = np.concatenate([lines[i][:a], np.zeros(int(pad * SR), np.float32), lines[i][a:]])
        marks[i] = marks[i][:1] + [round(m + pad, 3) for m in marks[i][1:]]
        word_marks[i] = [[w, round(s + pad, 3) if s >= cut - 0.05 else s] for w, s in word_marks[i]]
        dur[i] = len(lines[i]) / SR
    d = dur[i]
    end = t + lead + d + 1.5 if i == len(dur) - 1 else snap(t + lead + d + GAP + R.get('hold', {}).get(i, 0), BEAT / 2)
    scenes.append({'start': round(t, 3), 'end': round(end, 3), 'vo': round(t + lead, 3), 'voEnd': round(t + lead + d, 3),
                   'marks': [round(t + lead + m, 3) for m in marks[i]],
                   'words': [[w, round(t + lead + at, 3)] for w, at in word_marks[i]]})
    t = end
TOTAL = round(t, 3)
json.dump({'total': TOTAL, 'bpm': BPM, 'reel': REEL, 'scenes': scenes}, open(BUILD + '/timeline.json', 'w'), indent=1)
print(REEL, 'total', TOTAL)

n = int(TOTAL * SR) + SR
voice = np.zeros(n, np.float32)
for s, x in zip(scenes, lines):
    a = int(s['vo'] * SR); voice[a:a + len(x)] += x
voice /= max(1e-6, np.abs(voice).max()) / 0.9

# The instruments, as in audio.py.
rng = np.random.default_rng(7)
def hz(m): return 440.0 * 2 ** ((m - 69) / 12)
CHORDS, ROOTS, MELODY = R['chords'], R['roots'], R.get('melody')

def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR); out = np.empty_like(x); prev = 0.0
    for i in range(0, len(x), 8192):
        seg = x[i:i + 8192]; res = np.empty_like(seg)
        for j, v in enumerate(seg):
            prev = (1 - a) * v + a * prev; res[j] = prev
        out[i:i + 8192] = res
    return out
def env(L, a, r):
    e = np.ones(L, np.float32); na, nr = max(1, int(a * SR)), max(1, int(r * SR))
    e[:na] = np.linspace(0, 1, na); e[-nr:] *= np.linspace(1, 0, nr); return e

music = np.zeros((n, 2), np.float32)
def at(sec, sig, gain=1.0, pan=0.0):
    a = int(sec * SR)
    if a >= n or a < 0: return
    end = min(n, a + len(sig))
    music[a:end, 0] += sig[:end - a] * gain * (1 - max(0, pan))
    music[a:end, 1] += sig[:end - a] * gain * (1 + min(0, pan))

def kick():
    L = int(0.3 * SR); x = np.arange(L) / SR
    f = 48 + 110 * np.exp(-x * 32)
    return (np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-x * 11) + 0.25 * rng.standard_normal(L) * np.exp(-x * 120)) * 0.95
def clap():
    L = int(0.22 * SR); x = np.arange(L) / SR
    noise = rng.standard_normal(L).astype(np.float32); noise = noise - lowpass(noise, 900)
    bursts = np.exp(-x * 30) + 0.6 * np.exp(-np.maximum(0, x - 0.012) * 40) * (x > 0.012)
    return lowpass(noise, 5000) * bursts * 0.45
def hat(open_=False):
    L = int((0.12 if open_ else 0.04) * SR); x = np.arange(L) / SR
    noise = rng.standard_normal(L).astype(np.float32); noise = noise - lowpass(noise, 7000)
    return noise * np.exp(-x * (18 if open_ else 90)) * 0.28
def bass(m, length):
    L = int(length * SR); x = np.arange(L) / SR
    s = np.sin(2 * np.pi * hz(m) * x) + 0.4 * np.sin(4 * np.pi * hz(m) * x)
    return np.tanh(1.8 * s) * env(L, 0.005, 0.05) * 0.3
def pluck(m, gain=0.12):
    L = int(0.4 * SR); x = np.arange(L) / SR
    s = (np.sin(2 * np.pi * hz(m) * x) + 0.5 * np.sin(4 * np.pi * hz(m) * x) * np.exp(-x * 8)) * np.exp(-x * 9)
    return s * gain
def bell(m):
    L = int(0.9 * SR); x = np.arange(L) / SR
    s = np.sin(2 * np.pi * hz(m) * x) + 0.35 * np.sin(2 * np.pi * hz(m) * 2.01 * x) * np.exp(-x * 5) + 0.15 * np.sin(2 * np.pi * hz(m) * 3 * x) * np.exp(-x * 9)
    return s * np.exp(-x * 3.2) * 0.1
def stab(chord, length):
    L = int(length * SR); x = np.arange(L) / SR; s = np.zeros(L, np.float32)
    for m in chord + [chord[0] + 12]:
        for det in (-0.08, 0.08):
            f = hz(m) * (1 + det / 100); ph = 2 * np.pi * f * x
            s += 0.5 * (2 * (x * f % 1) - 1) + 0.5 * np.sin(ph)
    return lowpass(s * env(L, 0.01, length * 0.6), 2600) * 0.045
def riser(length):
    L = int(length * SR); x = np.arange(L) / SR
    noise = rng.standard_normal(L).astype(np.float32)
    sweep = lowpass(noise, 4000) * (x / length) ** 2
    tone = np.sin(2 * np.pi * np.cumsum(200 + 900 * (x / length) ** 2) / SR) * (x / length) ** 3 * 0.15
    return (sweep * 0.35 + tone)
def swell(length):
    L = int(length * SR); x = np.arange(L) / SR
    return lowpass(rng.standard_normal(L).astype(np.float32), 2500) * (x / length) ** 2.5 * 0.22
def impact():
    L = int(1.2 * SR); x = np.arange(L) / SR
    boom = np.sin(2 * np.pi * np.cumsum(40 + 60 * np.exp(-x * 8)) / SR) * np.exp(-x * 3.5)
    noise = lowpass(rng.standard_normal(L).astype(np.float32), 3000) * np.exp(-x * 9) * 0.5
    return (boom + noise) * 0.55

def echo(x, delay, feedback, mix):
    """A simple feedback delay, for the coach reel's piano."""
    out = x.copy(); d = int(delay * SR)
    for k in range(1, 6):
        if d * k >= len(x): break
        out[d * k:] += x[:len(x) - d * k] * (feedback ** k) * mix
    return out
def piano(m, length=1.6, gain=0.13):
    # Round and bright: a quick attack, a long decay, a little detune.
    L = int(length * SR); x = np.arange(L) / SR
    s = sum(np.sin(2 * np.pi * hz(m) * f * x) * a for f, a in ((1, 1), (2.002, 0.4), (3.001, 0.15), (0.998, 0.4)))
    return s * np.minimum(1, x / 0.006) * np.exp(-x * 2.2) * gain
def strings(chord, length, gain=0.05):
    # A slow-swelling section: detuned saws, filtered, a soft half-second attack.
    L = int(length * SR); x = np.arange(L) / SR; s = np.zeros(L, np.float32)
    for m in chord + [chord[0] - 12]:
        for det in (-0.12, 0, 0.12):
            f = hz(m) * (1 + det / 100); s += 2 * (x * f % 1) - 1
    e = np.minimum(1, x / 0.5) * np.minimum(1, (length - x) / 0.4)
    return lowpass(s * e, 1800) * gain

if R.get('mood') == 'uplifting':
    sc = scenes
    DROP = sc[REVEAL]['start']
    QUESTIONS = sc[1]['start']
    H = hat()
    pump = np.ones(n, np.float32)
    keys = np.zeros(n, np.float32)
    b = 0.0
    while b < TOTAL + BEAT:
        bar_i = int(b / BAR) % 4; beat_i = int(round(b / BEAT)) % 4
        lifted = b >= DROP
        chord = CHORDS[bar_i]
        # A rolling piano: the chord broken in eighths, rising, the top note an octave up after the lift.
        roll = chord + [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[1] + 12, chord[0] + 12]
        for k in range(2):
            a = int((b + k * BEAT / 2) * SR); p = piano(roll[(beat_i * 2 + k) % len(roll)] + (12 if lifted and k else 0))
            if a < n: keys[a:a + len(p)] += p[:max(0, min(len(p), n - a))]
        # A soft pulse from the questions on; after the lift a light kick on every beat, claps on 2 and 4, the bells.
        if QUESTIONS <= b < DROP and beat_i == 0: at(b, kick(), 0.3)
        if lifted and b < TOTAL - 1.2:
            at(b, kick(), 0.6)
            if beat_i in (1, 3): at(b, clap(), 0.45)
            at(b + BEAT / 2, H, 0.4, 0.3)
            at(b, bell(MELODY[bar_i][beat_i]), 0.9, 0.15)
        b += BEAT
    keys = echo(keys, BEAT * 0.75, 0.35, 0.45)
    music[:, 0] += keys; music[:, 1] += keys * 0.94
    # Strings and bass a bar at a time: swelling louder through the questions, full after the lift.
    for bar in range(int(TOTAL / BAR) + 2):
        a0 = bar * BAR
        if a0 >= TOTAL: break
        grow = 0.5 if a0 < QUESTIONS else min(1.0, 0.6 + 0.4 * (a0 - QUESTIONS) / max(1, DROP - QUESTIONS)) if a0 < DROP else 1.3
        at(a0, strings(CHORDS[bar % 4], BAR * 1.02), grow, 0.0)
        at(a0, bass(ROOTS[bar % 4], BAR * 0.9) * 0.6, 0.5 if a0 < DROP else 0.8)
    # The lift: a rising swell into the answer, and a bright last chord.
    at(DROP - 2.2, swell(2.2) * 1.8, 1.0)
    at(TOTAL - 2.4, strings([67, 71, 74, 79], 2.4, 0.07), 1.0)
elif R.get('mood') == 'relationship':
    sc = scenes
    FIGHTS, ASK, DROP, REPORT, CLOSE = sc[1]['start'], sc[2]['start'], sc[3]['start'], sc[4]['start'], sc[5]['start']
    END = sc[5]['voEnd'] + 0.6
    EIGHTH = BEAT / 2
    def lp(x, fc):
        X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
        return np.fft.irfft(X / np.sqrt(1 + (f / fc) ** 4), len(x)).astype(np.float32)
    def rhodes(m, length=2.0, gain=0.07):
        # An electric piano: a tine with a bell on the attack and a slow tremolo.
        L = int(length * SR); x = np.arange(L) / SR; f = hz(m)
        y = np.sin(2 * np.pi * f * x + 1.4 * np.exp(-x * 7) * np.sin(2 * np.pi * f * x)) + 0.25 * np.sin(2 * np.pi * f * 2 * x) * np.exp(-x * 3)
        y *= np.exp(-x * 1.3) * (1 + 0.18 * np.sin(2 * np.pi * 4.2 * x)) * np.minimum(1, x / 0.004) * np.clip((length - x) / 0.1, 0, 1)
        return y.astype(np.float32) * gain
    def vibes(m, gain=0.06):
        L = int(1.6 * SR); x = np.arange(L) / SR; f = hz(m)
        y = np.sin(2 * np.pi * f * x) + 0.3 * np.sin(2 * np.pi * f * 4 * x) * np.exp(-x * 8)
        return (y * np.exp(-x * 2.2) * (1 + 0.25 * np.sin(2 * np.pi * 5.5 * x))).astype(np.float32) * gain
    def brush():
        L = int(0.35 * SR); x = np.arange(L) / SR; noise = rng.standard_normal(L).astype(np.float32)
        return lp(noise - lp(noise, 1500), 6000) * np.minimum(1, x / 0.03) * np.exp(-x * 9) * 0.3
    def rim():
        L = int(0.06 * SR); x = np.arange(L) / SR
        return (np.sin(2 * np.pi * 1800 * x) * np.exp(-x * 120) + np.sin(2 * np.pi * 520 * x) * np.exp(-x * 60) * 0.5) * 0.25
    def soft_bass(m, length):
        L = int(length * SR); x = np.arange(L) / SR
        return (np.sin(2 * np.pi * hz(m) * x) + 0.2 * np.sin(4 * np.pi * hz(m) * x)) * np.minimum(1, x / 0.01) * np.clip((length - x) / 0.08, 0, 1) * 0.3
    def pad(chord, length, gain=0.03):
        L = int(length * SR); x = np.arange(L) / SR; y = np.zeros(L, np.float32)
        for m in chord + [chord[0] + 12]:
            for det in (-0.12, 0.12): y += np.sin(2 * np.pi * hz(m) * (1 + det / 100) * x) + 0.2 * (2 * (x * hz(m) * (1 + det / 100) % 1) - 1)
        return lp(y * np.minimum(1, x / 0.6) * np.clip((length - x) / 0.5, 0, 1), 1500) * gain
    K = kick()
    pump = np.ones(n, np.float32)
    # The ending: the last chord on its own bar; a reel may lead into it with a cadence, a bar of two chords.
    last = snap(END - BAR, BAR)
    CADENCE = R.get('cadence')
    stop = last - BAR if CADENCE else END - BAR
    b = 0.0
    while b < END:
        k8 = int(round(b / EIGHTH)); bar_i = k8 // 8 % 4; e = k8 % 8; beat_i = e // 2
        chord, root = CHORDS[bar_i], ROOTS[bar_i]
        if b >= stop: b += EIGHTH; continue
        # The electric piano: the chord on the one and the and of two, the top note answering.
        if e in (0, 3):
            for m in chord: at(b, rhodes(m + 12, 2.2, 0.05), 1.0, -0.15)
        if e == 6: at(b, rhodes(chord[2] + 24, 1.2, 0.04), 1.0, 0.2)
        if e == 0: at(b, pad(chord, BAR * 1.02), 1.0)
        if FIGHTS <= b < ASK:
            # The fights: a low pulse on every beat that tightens into eighths, the bass under it.
            tight = (b - FIGHTS) / max(0.1, ASK - FIGHTS)
            if e % 2 == 0 or tight > 0.6: at(b, K, 0.25 + 0.2 * tight)
            if e == 0: at(b, soft_bass(root - 12, BAR * 0.95), 0.8)
        elif DROP <= b:
            # The answer and after: a soft groove, brushed snare on two and four, a rim on the offbeats, the bass, the tune.
            full = b >= REPORT
            if e in (0, 5): at(b, K, 0.55)
            if e in (2, 6): at(b, brush(), 1.0)
            if e % 2 == 1: at(b, rim(), 0.6 if full else 0.4, 0.3)
            if e in (0, 3, 4): at(b, soft_bass(root - 12, EIGHTH * 1.7), 1.0)
            if e % 2 == 0: at(b, vibes(MELODY[bar_i][beat_i], 0.06 if full else 0.045), 1.0, 0.15)
        b += EIGHTH
    # A swell into the answer. The cadence, if any: its two chords on the electric piano over the bass, the tune's
    # last notes on the vibraphone. Then the last chord (the reel's home key; A for this one) rolled softly up the
    # electric piano over a swelling pad.
    at(DROP - 1.6, swell(1.6), 0.8)
    if CADENCE:
        for k, (ch, rt) in enumerate(CADENCE):
            at(last - BAR + k * BAR / 2, pad(ch, BAR / 2 + 0.1, 0.035), 1.0); at(last - BAR + k * BAR / 2, soft_bass(rt - 12, BAR / 2), 0.9)
            for m in ch: at(last - BAR + k * BAR / 2, rhodes(m + 12, 2.0, 0.05), 1.0, -0.15)
            at(last - BAR + k * BAR / 2 + BEAT, vibes(ch[-1] + 12, 0.045), 1.0, 0.15)
    end = R.get('end_chord', [45, 57, 61, 64, 69, 73])
    for k, m in enumerate(end): at(last + k * 0.1, rhodes(m, 3.2, 0.045), 1.0)
    at(last - 0.6, pad(end[1:4], 3.8, 0.04), 1.0)
    if CADENCE: at(last + 0.6, vibes(end[-1] + 12, 0.04), 1.0, 0.15)
elif R.get('mood') == 'career':
    sc = scenes
    QUESTIONS, DROP, REPORT, CLOSE = sc[1]['start'], sc[3]['start'], sc[4]['start'], sc[5]['start']
    END = sc[5]['voEnd'] + 0.6
    LIFT, LROOTS = R['lift'], R['lift_roots']
    EIGHTH = BEAT / 2
    def lp(x, fc):
        X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
        return np.fft.irfft(X / np.sqrt(1 + (f / fc) ** 4), len(x)).astype(np.float32)
    def felt(m, length=1.6, gain=0.11):
        # A felt piano: the piano, muffled.
        return lp(piano(m, length, gain).astype(np.float32), 1800)
    def finger_snap():
        L = int(0.12 * SR); x = np.arange(L) / SR; noise = rng.standard_normal(L).astype(np.float32)
        return (lp(noise - lp(noise, 1500), 7000) * np.exp(-x * 45) + np.sin(2 * np.pi * 1700 * x) * np.exp(-x * 80) * 0.3) * 0.5
    def shaker():
        L = int(0.06 * SR); x = np.arange(L) / SR; noise = rng.standard_normal(L).astype(np.float32)
        return (noise - lp(noise, 6000)) * np.minimum(1, x / 0.01) * np.exp(-x * 60) * 0.18
    def warm_bass(m, length):
        L = int(length * SR); x = np.arange(L) / SR
        y = np.sin(2 * np.pi * hz(m) * x) + 0.25 * np.sin(4 * np.pi * hz(m) * x)
        return y * np.minimum(1, x / 0.01) * np.clip((length - x) / 0.06, 0, 1) * 0.3
    def pad(chord, length, gain=0.03):
        L = int(length * SR); x = np.arange(L) / SR; y = np.zeros(L, np.float32)
        for m in chord + [chord[0] + 12]:
            for det in (-0.12, 0.12): y += np.sin(2 * np.pi * hz(m) * (1 + det / 100) * x) + 0.25 * (2 * (x * hz(m) * (1 + det / 100) % 1) - 1)
        return lp(y * np.minimum(1, x / 0.6) * np.clip((length - x) / 0.5, 0, 1), 1600) * gain
    K, C, HO = kick(), clap(), hat(True)
    pump = np.ones(n, np.float32)
    b = 0.0
    while b < END:
        k8 = int(round(b / EIGHTH)); bar_i = k8 // 8 % 4; e = k8 % 8; beat_i = e // 2
        lifted = b >= DROP
        chord, root = (LIFT[bar_i], LROOTS[bar_i]) if lifted else (CHORDS[bar_i], ROOTS[bar_i])
        full = REPORT <= b < CLOSE + BAR
        # The piano: the chord broken in eighths, rising; an octave up after the lift.
        roll = chord + [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[1] + 12, chord[0] + 12, chord[2]]
        if b < END - BAR or e == 0: at(b, felt(roll[e] + (12 if lifted else 0), 1.4, 0.09 if lifted else 0.11), 1.0, 0.2 if e % 2 else -0.2)
        if e == 0: at(b, pad(chord, BAR * 1.02, 0.03 if not lifted else 0.04), 1.0)
        if not lifted:
            # A slow pulse from the questions on: a soft low kick on the beat, the bass held.
            if b >= QUESTIONS and e % 2 == 0: at(b, K, 0.35 if e == 0 else 0.2)
            if b >= QUESTIONS and e == 0: at(b, warm_bass(root - 12, BAR * 0.95), 0.8)
        elif b < (CLOSE if R.get('calm_close') else CLOSE + BAR):
            # The light beat: kick on one and three (and the and of two), snaps on two and four, a shaker in sixteenths.
            if e in (0, 3, 4):
                at(b, K, 0.75)
                a_ = int(b * SR); L = int(0.18 * SR)
                if a_ < n: pump[a_:a_ + L] = np.minimum(pump[a_:a_ + L], 0.55 + 0.45 * np.linspace(0, 1, min(L, n - a_)) ** 0.6)
            if e in (2, 6): at(b, finger_snap(), 0.8); at(b, C, 0.45 if full else 0.0)
            at(b, shaker(), 0.8, 0.3); at(b + EIGHTH / 2, shaker(), 0.5, 0.3)
            if full and e == 7: at(b, HO, 0.3, -0.3)
            if e in (0, 3, 4, 6): at(b, warm_bass(root - 12 + (12 if e == 3 else 0), EIGHTH * 1.6), 1.0)
            # The tune, plucked, on the beat.
            if e % 2 == 0: at(b, pluck(MELODY[bar_i][beat_i], 0.12 if full else 0.09), 1.0, 0.15)
            if full and e % 2 == 0: at(b, pluck(MELODY[bar_i][beat_i] + 12, 0.04), 1.0, -0.15)
        b += EIGHTH
    # A swell into the answer, a lift into the report, and the last chord held.
    at(DROP - 2.0, swell(2.0) * 1.4, 1.0); at(DROP, impact(), 0.35)
    at(REPORT - 1.0, swell(1.0), 1.0)
    # The last chord, D, rolled softly up the piano a note at a time over a pad already swelling, nothing struck at once.
    last = snap(END - BAR, BAR)
    for k, m in enumerate([LIFT[0][0] - 12] + LIFT[0] + [LIFT[0][0] + 12]): at(last + k * 0.09, felt(m, 3.0, 0.055), 1.0)
    at(last - 0.6, pad(LIFT[0], 3.6, 0.045), 1.0)
elif R.get('mood') == 'roast':
    sc = scenes
    DROP = sc[1]['start']                         # the roast button: a riser, then the beat
    ADVICE, CTA = sc[4]['start'], sc[5]['start']  # the honest friend's breakdown, then everything back for the ask
    PUNCH = [sc[i]['marks'][1] for i in R['punch']]
    END = sc[5]['voEnd'] + 0.4
    RIFF = R['riff']
    EIGHTH = BEAT / 2

    def lp(x, fc):
        # A gentle low-pass done in one go in the frequency domain (the sample-by-sample one is slow for this many notes).
        X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
        return np.fft.irfft(X / np.sqrt(1 + (f / fc) ** 4), len(x)).astype(np.float32)
    def drive(x, k): return np.tanh(k * x) / np.tanh(k)
    def saw(f, x): return 2 * (np.cumsum(np.broadcast_to(f, x.shape)) / SR % 1) - 1
    def brass(chord, length, bright=6000, gain=0.05):
        # A bright brass section: detuned saws that scoop into the note, the filter opening on the attack.
        L = int(length * SR); x = np.arange(L) / SR; y = np.zeros(L, np.float32); scoop = 1 - 0.03 * np.exp(-x * 40)
        for m in chord:
            for det in (-0.15, 0.0, 0.15): y += saw(hz(m) * (1 + det / 100) * scoop, x)
        y *= np.minimum(1, x / 0.01) * np.clip((length - x) / 0.05, 0, 1)
        dull, sharp = lp(y, 900), lp(y, bright)
        return drive((dull + (sharp - dull) * np.exp(-x * 7)) * 0.3, 1.5) * gain * 5
    def house_bass(m, length):
        L = int(length * SR); x = np.arange(L) / SR
        y = np.sin(2 * np.pi * hz(m) * x) + 0.2 * saw(hz(m), x)
        return drive(lp(y.astype(np.float32), 900) * np.minimum(1, x / 0.004) * np.clip((length - x) / 0.03, 0, 1), 2.0) * 0.35
    def stab(chord, length, gain=0.08):
        # A house piano stab.
        L = int(length * SR); x = np.arange(L) / SR; y = np.zeros(L, np.float32)
        for m in chord:
            for k, a_ in ((1, 1), (2, 0.5), (3, 0.25), (4, 0.12)): y += np.sin(2 * np.pi * hz(m) * k * x) * a_ * np.exp(-x * (5 + 2 * k))
        return y * np.minimum(1, x / 0.003) * np.clip((length - x) / 0.05, 0, 1) * gain
    def pad(chord, length, gain=0.035):
        L = int(length * SR); x = np.arange(L) / SR; y = np.zeros(L, np.float32)
        for m in chord:
            for det in (-0.15, 0.15): y += np.sin(2 * np.pi * hz(m) * (1 + det / 100) * x) + 0.3 * saw(hz(m), x)
        return lp(y * np.minimum(1, x / 0.5) * np.clip((length - x) / 0.5, 0, 1), 1500) * gain
    def crash():
        L = int(1.8 * SR); x = np.arange(L) / SR; noise = rng.standard_normal(L).astype(np.float32)
        return (noise - lp(noise, 5000)) * np.exp(-x * 2.3) * 0.3
    def reverse_crash(length): return crash()[:int(length * SR)][::-1].copy() * 1.2
    notes = {}
    def hook_note(m, length):
        key = (m, round(length, 3))
        if key not in notes: notes[key] = brass([m, m - 12], length, 6000, 0.05)
        return notes[key]

    K, C, H, HO = kick(), clap(), hat(), hat(True)
    pump = np.ones(n, np.float32)
    b = 0.0
    while b < END:
        k8 = int(round(b / EIGHTH)); bar_i = k8 // 8 % 4; e = k8 % 8
        chord, root = CHORDS[bar_i], ROOTS[bar_i]
        hook, adv, cta = b < DROP, ADVICE <= b < CTA, b >= CTA
        # The beat drops out for the beat before each punchline.
        held = any(p - BEAT - 0.01 <= b < p - 0.01 for p in PUNCH)
        if hook:
            # The nice card: piano stabs and a soft kick, hats coming in.
            if e % 2 == 0: at(b, K, 0.35)
            if e in (0, 3, 6): at(b, stab(chord, EIGHTH * 1.5), 0.9, 0.2)
            if e % 2 == 1 and b > DROP - 2 * BAR: at(b, HO, 0.2, 0.3)
        elif adv or cta:
            # From the honest friend to the end, the breakdown: held chords and a pad, the piano on the one, the bass
            # held, no drums. The last bar is left to the closing chord.
            if e == 0 and b < END - BAR:
                at(b, pad(chord, BAR * 1.02), 1.0); at(b, stab(chord + [chord[0] + 12], BAR * 0.9, 0.06), 1.0)
                at(b, house_bass(root, BAR * 0.9) * 0.6, 0.7)
        elif not held:
            # Four on the floor, an open hat on every offbeat, claps on two and four.
            if e % 2 == 0:
                at(b, K, 1.0)
                a_ = int(b * SR); L = int(0.2 * SR)
                if a_ < n: pump[a_:a_ + L] = np.minimum(pump[a_:a_ + L], 0.45 + 0.55 * np.linspace(0, 1, min(L, n - a_)) ** 0.6)
            else: at(b, HO, 0.4, 0.3)
            at(b, H, 0.25, -0.3)
            if e in (2, 6): at(b, C, 0.85)
            # The funky octave bass, and the piano stabs.
            if e in (0, 3, 5, 7): at(b, house_bass(root + (12 if e in (3, 7) else 0), EIGHTH * 0.8), 1.0)
            if e in (0, 3, 6): at(b, stab(chord, EIGHTH * 1.5), 0.9, 0.2)
            # The hook: under the voice (the mix ducks it), out in front for the ask.
            m = RIFF[bar_i][e]
            if m: at(b, hook_note(m, EIGHTH * 0.85), 1.3 if cta else 0.8, -0.1)
        b += EIGHTH

    HIT = [53, 60, 65, 69, 72]   # the horn hit: F, wide

    # The roast button: a reversed crash and riser into the drop.
    at(DROP - 1.4, reverse_crash(1.4), 0.9); at(DROP - 1.4, riser(1.4), 0.5)
    at(DROP, brass(HIT, 1.0, 6000, 0.09), 1.0); at(DROP, crash(), 1.0); at(DROP, impact(), 0.7)
    # Each punchline: a gentle landing, a soft swell into a piano chord with the bass under it (a horn hit, a crash
    # and a boom were too harsh, 24 October 2026).
    for p in PUNCH:
        at(p - 0.45, reverse_crash(0.45), 0.25); at(p, stab([53, 60, 65, 69, 72], 1.2, 0.07), 1.0); at(p, house_bass(41, 0.9) * 0.7, 0.8)
    # Into the honest friend, a soft crash as the beat falls away. At the end, a reversed cymbal and a swell rise
    # gently into the last chord, F, held on the piano and pad, with nothing struck under it.
    at(ADVICE, crash(), 0.5)
    last = snap(END - BAR, BAR)
    at(last - 1.2, reverse_crash(1.2), 0.45); at(last - 1.2, swell(1.2), 0.6)
    at(last, stab([53, 60, 65, 69, 72, 77], 3.0, 0.06), 1.0); at(last, pad([65, 69, 72], 3.0, 0.05), 1.0)
    at(last, house_bass(41, 2.5) * 0.6, 0.6)
elif R.get('mood') == 'mirror':
    sc = scenes
    CLAIMS = sc[0]['start']                    # the beat from the start
    DROP = sc[R['reveal']]['start']            # the close: opening into F major
    PUNCH = [sc[i]['marks'][1] for i in R['punch']]
    END = sc[-1]['voEnd'] + 0.6
    EIGHTH = BEAT / 2
    SW = R['swing']

    def lp(x, fc):
        X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
        return np.fft.irfft(X / np.sqrt(1 + (f / fc) ** 4), len(x)).astype(np.float32)
    def rhodes(chord, length, gain=0.045):
        # A warm electric piano: a bell-ish attack over a round body, a slow tremolo, the top a little dull.
        L = int(length * SR); x = np.arange(L) / SR; y = np.zeros(L, np.float32)
        for m in chord:
            y += np.sin(2 * np.pi * hz(m) * x) + 0.3 * np.sin(2 * np.pi * hz(m) * 2 * x) * np.exp(-x * 3) \
                 + 0.1 * np.sin(2 * np.pi * hz(m) * 7 * x) * np.exp(-x * 16)
        trem = 1 + 0.1 * np.sin(2 * np.pi * 4.2 * x)
        return lp((y * trem * np.minimum(1, x / 0.01) * np.exp(-x * 0.8) * np.clip((length - x) / 0.3, 0, 1) * gain).astype(np.float32), 3200)
    def lofi_kick():
        L = int(0.35 * SR); x = np.arange(L) / SR
        return (np.sin(2 * np.pi * np.cumsum(50 + 70 * np.exp(-x * 28)) / SR) * np.exp(-x * 9) * 0.9).astype(np.float32)
    def lofi_snare():
        L = int(0.3 * SR); x = np.arange(L) / SR
        noise = rng.standard_normal(L).astype(np.float32)
        return (lp(noise - lp(noise, 1200), 4500) * np.exp(-x * 14) * 0.35 + np.sin(2 * np.pi * 180 * x) * np.exp(-x * 25) * 0.2).astype(np.float32)
    def lofi_hat():
        L = int(0.05 * SR); x = np.arange(L) / SR
        noise = rng.standard_normal(L).astype(np.float32)
        return lp(noise - lp(noise, 6000), 9000) * np.exp(-x * 70) * 0.16
    def round_bass(m, length):
        L = int(length * SR); x = np.arange(L) / SR
        y = np.sin(2 * np.pi * hz(m) * x) + 0.15 * np.sin(4 * np.pi * hz(m) * x)
        return (y * np.minimum(1, x / 0.01) * np.exp(-x * 1.2) * np.clip((length - x) / 0.06, 0, 1) * 0.3).astype(np.float32)
    def pad_(chord, length, gain=0.022):
        L = int(length * SR); x = np.arange(L) / SR; y = np.zeros(L, np.float32)
        for m in chord:
            for det in (-0.12, 0.12): y += np.sin(2 * np.pi * hz(m) * (1 + det / 100) * x)
        return lp((y * np.minimum(1, x / 0.4) * np.clip((length - x) / 0.4, 0, 1) * gain).astype(np.float32), 1600)
    def crackle(length):
        L = int(length * SR); y = np.zeros(L, np.float32)
        hits = rng.integers(0, L, int(length * 22))
        y[hits] = rng.standard_normal(len(hits)).astype(np.float32) * 0.5
        return lp(y, 5000) * 0.25 + lp(rng.standard_normal(L).astype(np.float32), 700) * 0.012
    K, SN, HH = lofi_kick(), lofi_snare(), lofi_hat()
    pump = np.ones(n, np.float32)
    at(0, crackle(TOTAL), 0.6)
    b = 0.0
    while b < END:
        k8 = int(round(b / EIGHTH)); bar_i = k8 // 8 % 4; e = k8 % 8
        warm = b >= DROP
        chords, roots = (R['lift'], R['lift_roots']) if warm else (R['chords'], R['roots'])
        chord, root = chords[bar_i], roots[bar_i]
        swung = b + (SW if e % 2 else 0)
        if b < END - BAR:
            if e == 0:
                at(b, rhodes(chord, BAR * 1.02), 1.0, -0.1)
                # A soft pad under it all, so no bar falls quiet at its end.
                at(b, pad_(chord, BAR * 1.04), 1.0)
            if e == 5: at(swung, rhodes(chord[1:], BEAT * 1.2, 0.03), 1.0, 0.15)
            if b >= CLAIMS:
                if e in (0, 5): at(swung, K, 0.8 if not warm else 0.6)
                if e in (2, 6): at(b, SN, 0.7 if not warm else 0.5)
                at(swung, HH, 0.9 if e % 2 else 0.6, 0.25)
                # A bouncing bass: root, the fifth, and back, on the swung eighths.
                if e in (0, 3, 4, 6): at(swung, round_bass(root + 12 + (7 if e == 3 else 0), BEAT * (1.4 if e == 0 else 0.7)), 1.0 if e == 0 else 0.8)
            if warm and e % 2 == 0: at(b, bell(R['melody'][bar_i][e // 2] + 12), 0.45, 0.2)
        b += EIGHTH

    # Each punchline: the groove rolls on, with a soft accent on it (a low piano chord and a little air).
    for i in R['punch']:
        p = sc[i]['marks'][1]
        at(p, rhodes([50, 57, 60, 65], 1.6, 0.05), 0.9); at(p, swell(0.6)[::-1].copy(), 0.35)
    # Into the card: a soft swell; at the end, the last chord held with nothing struck under it.
    at(DROP - 1.2, swell(1.2), 0.7)
    last = snap(END - BAR, BAR)
    at(last, rhodes([53, 60, 64, 67, 69, 72], 3.4, 0.05), 1.0); at(last, round_bass(29 + 12, 2.8), 0.8)

else:
    sc = scenes
    MID = sc[1]['start']       # a light pulse comes in after the hook
    DROP = sc[REVEAL]['start']  # the card: riser, hit, the full beat to the end
    K, C = kick(), clap()
    H, HO = hat(), hat(True)
    pump = np.ones(n, np.float32)
    b = 0.0
    while b < TOTAL + BEAT:
        bar_i = int(b / BAR) % 4; beat_i = int(round(b / BEAT)) % 4
        full = DROP <= b < TOTAL - 1.0
        mid = MID <= b < DROP
        if full or mid:
            at(b, K, 0.95 if full else 0.45)
            a = int(b * SR); L = int(0.22 * SR)
            if full and a < n: pump[a:a + L] = np.minimum(pump[a:a + L], 0.35 + 0.65 * np.linspace(0, 1, min(L, n - a)) ** 0.6)
        if (full or (mid and R['early_claps'])) and beat_i in (1, 3): at(b, C, 0.9 if full else 0.5)
        if full or mid:
            for k in range(4 if full else 2):
                at(b + k * BEAT / (4 if full else 2), H, 0.7 if k % 2 else 0.45, 0.3)
            if full and beat_i == 3: at(b + BEAT / 2, HO, 0.5, -0.3)
        if full:
            at(b + BEAT / 2, bass(ROOTS[bar_i] + 12, BEAT * 0.45), 1.0)
            at(b, bass(ROOTS[bar_i], BEAT * 0.3), 0.7)
        elif b >= MID:
            at(b, bass(ROOTS[bar_i], BEAT * 0.8), 0.6)
        # Plucks on the eighths; the second of each pair a touch late in a swung reel.
        notes = CHORDS[bar_i] + [CHORDS[bar_i][0] + 12]
        for k in range(2):
            m = notes[(beat_i * 2 + k) % 4] + 12
            at(b + k * (BEAT / 2 + R['swing']), pluck(m, 0.1 if not full else 0.08), 1.0, 0.4 if k else -0.4)
        if full and beat_i in (0, 2): at(b, stab(CHORDS[bar_i], BEAT * 0.9), 1.0)
        # The bell tune: soft before the reveal, leading after it with a soft octave above.
        lead = min(1, (b - DROP + BEAT) / (2 * BEAT)) if b >= DROP else 0
        at(b, bell(MELODY[bar_i][beat_i]), (0.55 if b < MID else 0.8) + 0.6 * lead, 0.15)
        if lead: at(b, bell(MELODY[bar_i][beat_i] + 12), 0.28 * lead, -0.15)
        b += BEAT

    for bar in range(int(TOTAL / BAR) + 2):
        a0 = bar * BAR
        if a0 >= DROP: break
        at(a0, stab(CHORDS[bar % 4], BAR * 1.05) * 1.6, 0.8)

    for k in range(1, REVEAL): at(sc[k]['start'] - 0.5, swell(0.5), 1.0)
    at(DROP - 1.6, riser(1.6), 0.9); at(DROP, impact(), 1.0)

if R.get('mood') == 'character':
    # The slot's ticks: one each time a tile passes, slowing as it does (the stage moves by the same curve).
    a0, a1 = sc[1]['start'], sc[R['reveal']]['start']
    def tick():
        L = int(0.05 * SR); x = np.arange(L) / SR
        click = np.sin(2 * np.pi * 2400 * x) * np.exp(-x * 160) + rng.standard_normal(L) * np.exp(-x * 300) * 0.3
        return (click * 0.22).astype(np.float32)
    TK = tick(); passed = 0
    for u in np.linspace(0, 1, 6000):
        pos = int(R['spin'] * (1 - (1 - u) ** R['spin_ease']))
        if pos > passed:
            passed = pos; at(a0 + u * (a1 - a0), TK, 0.9, 0.2 if pos % 2 else -0.2)
    # A sparkle on the landing.
    for k, m in enumerate([84, 88, 91, 96]): at(a1 + k * 0.06, bell(m), 0.9, 0.3 if k % 2 else -0.3)

music[:, 0] *= pump[:n]; music[:, 1] *= pump[:n]
fade = np.ones(n, np.float32)
fi = int(0.3 * SR); fade[:fi] = np.linspace(0, 1, fi)
# The roast's last hit rings on a little longer.
fo = int((TOTAL - (0.9 if R.get('mood') == 'roast' else 1.4)) * SR); fade[fo:] = np.clip(np.linspace(1, 0, n - fo) * 1.6, 0, 1)
music *= fade[:, None]
music /= max(1e-6, np.abs(music).max())

envv = lowpass(np.abs(voice), 8.0); envv /= max(1e-6, envv.max())
# As the main video's ending: the music swells at once on the hit and is ducked less after it.
swell_in = np.ones(n, np.float32)
f0 = int(DROP * SR); f1 = min(n, int((DROP + 0.35) * SR))
top = 1.35 if R.get('mood') in ('uplifting', 'career', 'relationship') else 1.6
swell_in[f0:f1] = np.linspace(1.0, top, f1 - f0); swell_in[f1:] = top
depth = np.where(np.arange(n) >= f0, 0.3, 0.5).astype(np.float32)
duck = 1 - depth * np.clip(envv * 2.4, 0, 1)
# A reel can lift its music from one scene to the end ('music_lift': (scene, gain)), eased in over half a second.
if R.get('music_lift'):
    li, lg = R['music_lift']; l0 = int(scenes[li]['start'] * SR); lift = np.ones(n, np.float32)
    lift[l0:] = lg; ramp = min(n - l0, int(0.5 * SR)); lift[l0:l0 + ramp] = np.linspace(1, lg, ramp)
    music = music * lift[:, None]
mix = music * (0.42 * duck * swell_in)[:, None] + voice[:, None] * 0.95
mix = np.tanh(mix * 1.15) / np.tanh(1.15)
mix /= max(1e-6, np.abs(mix).max()) / 0.89
mix = mix[: int(TOTAL * SR)]

def save(path, data):
    data = (np.clip(data, -1, 1) * 32767).astype(np.int16)
    w = wave.open(path, 'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(data.tobytes()); w.close()
save(BUILD + '/mix.wav', mix)
save(BUILD + '/music-only.wav', (music * 0.7)[: int(TOTAL * SR)])
print('wrote mix')
