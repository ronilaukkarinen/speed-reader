# ⚡ Speed reader

![Version](https://img.shields.io/badge/version-1.2.0-blue?style=for-the-badge)
![React](https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)

A web-based speed reading tool using Rapid Serial Visual Presentation (RSVP) with Optimal Recognition Point (ORP) alignment.

## Features

- Privacy-first, offline-first
- EPUB and TXT file support
- Settings and progress persisted to localStorage

<img width="1201" height="990" alt="localhost_5179_" src="https://github.com/user-attachments/assets/36ceee75-44fe-4852-a05a-e9dfa1a7a9c8" />

## Privacy-first, offline-first

Everything runs locally in your browser. Your text and files never leave your computer - no servers, no tracking, no analytics. EPUB and TXT files are processed entirely client-side. Settings and reading progress are stored in localStorage. Works offline once loaded.

Optional: If enabled in settings, missing book metadata (title, author, cover) can be fetched from [Open Library API](https://openlibrary.org/developers/api). This sends the book title to their servers.

## What is RSVP?

RSVP (Rapid Serial Visual Presentation) is a reading technique that displays text one word at a time at a fixed focal point. This eliminates saccades (eye movements) that normally slow down reading, allowing for significantly faster reading speeds.

## The science behind it

### Optimal Recognition Point (ORP)

When reading normally, your eyes don't land at the center of words. Research shows that fixations tend to occur slightly left of center, at what's called the Optimal Viewing Position (OVP) or Optimal Recognition Point (ORP). This position allows for fastest word recognition.

The ORP position follows the Spritz algorithm:

- 1 character: 1st letter
- 2-5 characters: 2nd letter
- 6-9 characters: 3rd letter
- 10-13 characters: 4th letter
- 14+ characters: 5th letter

### Fixed focal point

Traditional RSVP displays center each word, requiring small eye adjustments. This implementation aligns each word's ORP at the exact same screen position, so the highlighted letter never moves. Your eyes stay completely still while words flow around the focal point.

### Variable timing

The display time for each word is adjusted based on:

- Word length (longer words get more time)
- Punctuation (sentence-ending punctuation triggers a longer pause)

This mimics natural reading rhythm where comprehension requires variable processing time.

### Research findings

Studies have shown that RSVP reading can achieve speeds of 500+ words per minute, though comprehension tends to decrease above 350-400 WPM for complex texts. The technique works best for:

- Light reading and familiar content
- Skimming and preview reading
- Building reading speed gradually

Note: Extended RSVP reading can cause visual fatigue ([Benedetto et al., 2015](https://doi.org/10.1016/j.chb.2014.12.043)). Take breaks.

## Running locally

```bash
npm install
npm run dev
```

Then open http://localhost:5173

## Building for production

```bash
npm run build
```

Output will be in the `dist` folder.

## Inspiration and similar projects

- [RSVP Speed Reader](https://snowfluke.github.io/rsvp-speed-reader/) - Theme inspiration
- [Spritz](https://spritz.com/) - The commercial product that popularized ORP-based RSVP
- [OpenSpritz](https://github.com/Miserlou/OpenSpritz) - Open source Spritz implementation
- [speedread](https://github.com/pasky/speedread) - Terminal-based Spritz-alike in Perl
- [rsvp-reading](https://github.com/thomaskolmans/rsvp-reading) - Svelte-based RSVP reader with PDF/EPUB support
- [LetoReader](https://github.com/Axym-Labs/LetoReader) - Self-hostable speed reader with chunking and highlighting
- [tspreed](https://github.com/n-ivkovic/tspreed) - Terminal RSVP reader in POSIX shell

## Scientific references

- Masson, M. E. J. (1983). Conceptual processing of text during skimming and rapid sequential reading. _Memory & Cognition_, 11(3), 262-274.
- Rayner, K., Schotter, E. R., Masson, M. E., Potter, M. C., & Treiman, R. (2016). So much to read, so little time: How do we read, and can speed reading help? _Psychological Science in the Public Interest_, 17(1), 4-34.
- Benedetto, S., Carbone, A., Pedrotti, M., Le Fevre, K., Bey, L. A. Y., & Baccino, T. (2015). Rapid serial visual presentation in reading: The case of Spritz. _Computers in Human Behavior_, 45, 352-358.
