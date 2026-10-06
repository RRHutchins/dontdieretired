# Word list for the daily puzzle

`words.txt` holds every lower-case English word of four to nine letters from the standard British and
American lists of **SCOWL (Spell Checker Oriented Word Lists)**, maintained by Kevin Atkinson, taken from
the Debian packages `wbritish` and `wamerican`. Proper nouns, possessives and accented spellings are left out.
British and American spellings are both in, so both are accepted as answers.

`blocklist.txt` is our own list of words we will not use as answers or as the nine-letter word.

Nine-letter words for each day are chosen by `tools/build_puzzles.py`, which uses the `wordfreq` package
only to prefer everyday words when picking them. No `wordfreq` data is stored in this repository.

## Licence (from the SCOWL README, as shipped by Debian)

    Copyright 2000-2011 by Kevin Atkinson

    Permission to use, copy, modify, distribute and sell these word
    lists, the associated scripts, the output created from the scripts,
    and its documentation for any purpose is hereby granted without fee,
    provided that the above copyright notice appears in all copies and
    that both that copyright notice and this permission notice appear in
    supporting documentation. Kevin Atkinson makes no representations
    about the suitability of this array for any purpose. It is provided
    "as is" without express or implied warranty.

SCOWL draws on several sources, among them the Moby word lists (public domain), 12Dicts and ENABLE by Alan
Beale, and others listed in the SCOWL README: http://wordlist.aspell.net/scowl-readme/
